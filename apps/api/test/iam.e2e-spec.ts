import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, getPrisma, setupUserWithCompany, uniqueEmail } from "./utils/test-app";

describe("IAM admin (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  it("lists company users and lets an admin reset a member's password (old password stops working)", async () => {
    const ctx = await setupUserWithCompany(app);
    const prisma = getPrisma(app);

    // Second user, attached directly to the same company as a Viewer (no
    // invite endpoint exists yet — this mirrors what one would create).
    const memberEmail = uniqueEmail("member");
    const memberPassword = "OriginalPass123!";
    await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email: memberEmail, password: memberPassword, fullName: "Team Member" })
      .expect(201);
    const memberUser = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });
    const viewerRole = await prisma.role.findFirstOrThrow({ where: { companyId: ctx.companyId, name: "Viewer" } });
    await prisma.companyUser.create({
      data: { userId: memberUser.id, companyId: ctx.companyId, roleId: viewerRole.id, isDefault: true },
    });

    const listRes = await request(app.getHttpServer())
      .get("/iam/company-users")
      .set(auth(ctx.accessToken))
      .expect(200);
    const memberRow = listRes.body.find((u: any) => u.userId === memberUser.id);
    expect(memberRow).toBeDefined();
    expect(memberRow.roleName).toBe("Viewer");

    // Old password still works before the reset
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: memberEmail, password: memberPassword })
      .expect(201);

    const newPassword = "BrandNewPass456!";
    await request(app.getHttpServer())
      .patch(`/iam/users/${memberUser.id}/reset-password`)
      .set(auth(ctx.accessToken))
      .send({ newPassword })
      .expect(200);

    // Old password now rejected, new password works
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: memberEmail, password: memberPassword })
      .expect(401);
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: memberEmail, password: newPassword })
      .expect(201);
  });

  it("blocks resetting the password of a user outside the caller's company", async () => {
    const ctx = await setupUserWithCompany(app);
    const outsider = await setupUserWithCompany(app);
    const prisma = getPrisma(app);
    const outsiderUser = await prisma.user.findUniqueOrThrow({ where: { email: outsider.email } });

    await request(app.getHttpServer())
      .patch(`/iam/users/${outsiderUser.id}/reset-password`)
      .set(auth(ctx.accessToken))
      .send({ newPassword: "DoesNotMatter123!" })
      .expect(403);
  });

  it("lists the full permission catalog grouped by module", async () => {
    const ctx = await setupUserWithCompany(app);
    const res = await request(app.getHttpServer()).get("/iam/permissions").set(auth(ctx.accessToken)).expect(200);
    expect(res.body.length).toBeGreaterThan(20);
    const employeeView = res.body.find((p: any) => p.key === "hr.employee.view");
    expect(employeeView).toEqual({ key: "hr.employee.view", module: "hr" });
  });

  it("custom role: create with a restricted permission set, assign to a user, and the user is confined to exactly that access after re-login", async () => {
    const ctx = await setupUserWithCompany(app);
    const prisma = getPrisma(app);

    // A role that can only view/manage Employees — nothing else.
    const created = await request(app.getHttpServer())
      .post("/iam/roles")
      .set(auth(ctx.accessToken))
      .send({ name: "Employees Only", permissionKeys: ["hr.employee.view", "hr.employee.manage"] })
      .expect(201);
    expect(created.body.isSystem).toBe(false);
    expect(created.body.permissionKeys.sort()).toEqual(["hr.employee.manage", "hr.employee.view"]);

    const memberEmail = uniqueEmail("restricted");
    const memberPassword = "OriginalPass123!";
    await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email: memberEmail, password: memberPassword, fullName: "Restricted User" })
      .expect(201);
    const memberUser = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });
    await prisma.companyUser.create({
      data: { userId: memberUser.id, companyId: ctx.companyId, roleId: created.body.id, isDefault: true },
    });

    const memberLogin = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: memberEmail, password: memberPassword })
      .expect(201);
    const memberToken = memberLogin.body.accessToken;

    // Allowed: listing employees.
    await request(app.getHttpServer()).get("/hr/employees").set(auth(memberToken)).expect(200);
    // Allowed: read-only reference data the employee pages themselves need
    // (e.g. the allowance expense-account picker) — see the dedicated
    // AnyPermissions test below for full coverage of this.
    await request(app.getHttpServer()).get("/coa/accounts").set(auth(memberToken)).expect(200);
    // Denied: real module actions outside HR, e.g. viewing projects.
    await request(app.getHttpServer()).get("/projects").set(auth(memberToken)).expect(403);
  });

  it("custom role: editing permissions, system roles are protected, and delete is blocked while assigned then allowed after reassignment", async () => {
    const ctx = await setupUserWithCompany(app);
    const prisma = getPrisma(app);

    const role = (
      await request(app.getHttpServer())
        .post("/iam/roles")
        .set(auth(ctx.accessToken))
        .send({ name: "Purchase Invoices Only", permissionKeys: ["ap.invoice.view"] })
        .expect(201)
    ).body;

    // Expand its permissions.
    const updated = (
      await request(app.getHttpServer())
        .patch(`/iam/roles/${role.id}`)
        .set(auth(ctx.accessToken))
        .send({ permissionKeys: ["ap.invoice.view", "ap.invoice.create", "ap.invoice.post"] })
        .expect(200)
    ).body;
    expect(updated.permissionKeys.sort()).toEqual(["ap.invoice.create", "ap.invoice.post", "ap.invoice.view"]);

    // Duplicate name is rejected.
    await request(app.getHttpServer())
      .post("/iam/roles")
      .set(auth(ctx.accessToken))
      .send({ name: "Purchase Invoices Only", permissionKeys: [] })
      .expect(409);

    // System roles can't be edited or deleted.
    const viewerRole = await prisma.role.findFirstOrThrow({ where: { companyId: ctx.companyId, name: "Viewer" } });
    await request(app.getHttpServer())
      .patch(`/iam/roles/${viewerRole.id}`)
      .set(auth(ctx.accessToken))
      .send({ name: "Hacked Viewer" })
      .expect(403);
    await request(app.getHttpServer()).delete(`/iam/roles/${viewerRole.id}`).set(auth(ctx.accessToken)).expect(403);

    // Assign the custom role to a user, then deleting it is blocked while in use.
    const memberEmail = uniqueEmail("apuser");
    await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email: memberEmail, password: "SomePass123!", fullName: "AP User" })
      .expect(201);
    const memberUser = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });
    const membership = await prisma.companyUser.create({
      data: { userId: memberUser.id, companyId: ctx.companyId, roleId: role.id, isDefault: true },
    });

    await request(app.getHttpServer()).delete(`/iam/roles/${role.id}`).set(auth(ctx.accessToken)).expect(409);

    // Reassign to a system role via the company-user role endpoint, then delete succeeds.
    await request(app.getHttpServer())
      .patch(`/iam/company-users/${membership.id}/role`)
      .set(auth(ctx.accessToken))
      .send({ roleId: viewerRole.id })
      .expect(200);
    await request(app.getHttpServer()).delete(`/iam/roles/${role.id}`).set(auth(ctx.accessToken)).expect(200);

    const usersAfter = await request(app.getHttpServer()).get("/iam/company-users").set(auth(ctx.accessToken)).expect(200);
    const row = usersAfter.body.find((u: any) => u.userId === memberUser.id);
    expect(row.roleName).toBe("Viewer");
  });

  it("rejects a role id from a different company on both role-editing and company-user role-change endpoints", async () => {
    const ctx = await setupUserWithCompany(app);
    const other = await setupUserWithCompany(app);
    const prisma = getPrisma(app);

    const otherRole = await prisma.role.findFirstOrThrow({ where: { companyId: other.companyId, name: "Viewer" } });
    await request(app.getHttpServer())
      .patch(`/iam/roles/${otherRole.id}`)
      .set(auth(ctx.accessToken))
      .send({ name: "Cross-tenant rename" })
      .expect(404);

    const ownRole = await prisma.role.findFirstOrThrow({ where: { companyId: ctx.companyId, name: "Viewer" } });
    const ownMembership = await prisma.companyUser.findFirstOrThrow({ where: { companyId: ctx.companyId } });
    await request(app.getHttpServer())
      .patch(`/iam/company-users/${ownMembership.id}/role`)
      .set(auth(ctx.accessToken))
      .send({ roleId: otherRole.id })
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/iam/company-users/${ownMembership.id}/role`)
      .set(auth(ctx.accessToken))
      .send({ roleId: ownRole.id })
      .expect(200);
  });

  it("an HR-only role (view+manage) can still read the cross-module reference data its own pages need — cost centers, chart of accounts, fiscal periods — without being granted GL journal access", async () => {
    const ctx = await setupUserWithCompany(app);
    const prisma = getPrisma(app);

    const role = (
      await request(app.getHttpServer())
        .post("/iam/roles")
        .set(auth(ctx.accessToken))
        .send({ name: "HR Only", permissionKeys: ["hr.employee.view", "hr.employee.manage"] })
        .expect(201)
    ).body;

    const memberEmail = uniqueEmail("hronly");
    const memberPassword = "SomePass123!";
    await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email: memberEmail, password: memberPassword, fullName: "HR Only User" })
      .expect(201);
    const memberUser = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });
    await prisma.companyUser.create({
      data: { userId: memberUser.id, companyId: ctx.companyId, roleId: role.id, isDefault: true },
    });

    const memberLogin = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: memberEmail, password: memberPassword })
      .expect(201);
    const memberToken = memberLogin.body.accessToken;

    // The employee-list/detail pages' own routes.
    await request(app.getHttpServer()).get("/hr/employees").set(auth(memberToken)).expect(200);
    await request(app.getHttpServer()).get("/hr/reports/employees-dashboard").set(auth(memberToken)).expect(200);

    // Reference data those pages' dropdowns/selectors depend on but that
    // belongs to unrelated modules — must be readable via AnyPermissions,
    // not blocked behind gl.journal.view.
    await request(app.getHttpServer()).get("/cost-centers").set(auth(memberToken)).expect(200);
    await request(app.getHttpServer()).get("/coa/accounts").set(auth(memberToken)).expect(200);
    await request(app.getHttpServer()).get("/companies/current/fiscal-periods").set(auth(memberToken)).expect(200);

    // Still correctly denied real GL/journal actions — the fix only opens
    // read access to reference data, not journal posting/management.
    await request(app.getHttpServer()).get("/gl/journal-entries").set(auth(memberToken)).expect(403);
  });
});
