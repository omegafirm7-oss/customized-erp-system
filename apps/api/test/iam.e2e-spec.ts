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

  it("admin creates a user directly (no join-request needed) and they can immediately log in with the given password", async () => {
    const ctx = await setupUserWithCompany(app);
    const viewerRole = await getPrisma(app).role.findFirstOrThrow({ where: { companyId: ctx.companyId, name: "Viewer" } });

    const newEmail = uniqueEmail("admincreated");
    const newPassword = "AdminCreated123!";
    const createRes = await request(app.getHttpServer())
      .post("/iam/company-users")
      .set(auth(ctx.accessToken))
      .send({ email: newEmail, fullName: "Admin Created User", password: newPassword, roleId: viewerRole.id })
      .expect(201);
    expect(createRes.body.status).toBe("ACTIVE");

    await request(app.getHttpServer()).post("/auth/login").send({ email: newEmail, password: newPassword }).expect(201);

    // Creating the same email a second time for the same company is rejected.
    await request(app.getHttpServer())
      .post("/iam/company-users")
      .set(auth(ctx.accessToken))
      .send({ email: newEmail, fullName: "Admin Created User", password: newPassword, roleId: viewerRole.id })
      .expect(409);
  });

  it("suspending a user's access blocks new logins and refreshes immediately, and reactivating restores it", async () => {
    const ctx = await setupUserWithCompany(app);
    const prisma = getPrisma(app);
    const viewerRole = await prisma.role.findFirstOrThrow({ where: { companyId: ctx.companyId, name: "Viewer" } });
    // Given IAM_USER_MANAGE (via the Administrator role) so the mid-test
    // sensitive-route call below is meaningful — otherwise a Viewer would get
    // 403 regardless of suspension and the assertion would prove nothing.
    const adminRole = await prisma.role.findFirstOrThrow({ where: { companyId: ctx.companyId, name: "Administrator" } });

    const memberEmail = uniqueEmail("suspendee");
    const memberPassword = "SuspendMe123!";
    const createRes = await request(app.getHttpServer())
      .post("/iam/company-users")
      .set(auth(ctx.accessToken))
      .send({ email: memberEmail, fullName: "Suspend Me", password: memberPassword, roleId: adminRole.id })
      .expect(201);
    const companyUserId = createRes.body.id;

    // Log in once while active, capture both the access token and refresh cookie.
    const loginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: memberEmail, password: memberPassword })
      .expect(201);
    const memberAccessToken = loginRes.body.accessToken;
    const refreshCookie = loginRes.headers["set-cookie"][0];

    // Refresh works fine before suspension.
    const refreshBeforeSuspend = await request(app.getHttpServer())
      .post("/auth/refresh")
      .set("Cookie", refreshCookie)
      .expect(201);
    const refreshCookieAfterFirstRefresh = refreshBeforeSuspend.headers["set-cookie"][0];

    // Before suspension, their (Administrator-role) access token can use a
    // sensitive-marked route just fine.
    await request(app.getHttpServer())
      .patch(`/iam/company-users/${companyUserId}/role`)
      .set(auth(memberAccessToken))
      .send({ roleId: viewerRole.id })
      .expect(200);
    // ...restore them to admin so the later assertions still target an
    // IAM_USER_MANAGE-capable membership.
    await request(app.getHttpServer())
      .patch(`/iam/company-users/${companyUserId}/role`)
      .set(auth(ctx.accessToken))
      .send({ roleId: adminRole.id })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/iam/company-users/${companyUserId}/status`)
      .set(auth(ctx.accessToken))
      .send({ status: "SUSPENDED" })
      .expect(200);

    // New logins are rejected outright.
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: memberEmail, password: memberPassword })
      .expect(401);

    // The refresh token that was still valid pre-suspension no longer works.
    await request(app.getHttpServer())
      .post("/auth/refresh")
      .set("Cookie", refreshCookieAfterFirstRefresh)
      .expect(401);

    // Their still-valid access token immediately loses effect on any
    // sensitive-marked route (those re-check permissions live from the DB
    // instead of trusting what was baked into the JWT at login) — proving
    // suspension isn't just a login-time check.
    await request(app.getHttpServer())
      .patch(`/iam/company-users/${companyUserId}/role`)
      .set(auth(memberAccessToken))
      .send({ roleId: viewerRole.id })
      .expect(403);

    // Reactivate — login works again.
    await request(app.getHttpServer())
      .patch(`/iam/company-users/${companyUserId}/status`)
      .set(auth(ctx.accessToken))
      .send({ status: "ACTIVE" })
      .expect(200);
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: memberEmail, password: memberPassword })
      .expect(201);
  });

  it("removing a user's company access deletes their membership; they can no longer log into that company but the account itself survives", async () => {
    const ctx = await setupUserWithCompany(app);
    const prisma = getPrisma(app);
    const viewerRole = await prisma.role.findFirstOrThrow({ where: { companyId: ctx.companyId, name: "Viewer" } });

    const memberEmail = uniqueEmail("removee");
    const memberPassword = "RemoveMe123!";
    const createRes = await request(app.getHttpServer())
      .post("/iam/company-users")
      .set(auth(ctx.accessToken))
      .send({ email: memberEmail, fullName: "Remove Me", password: memberPassword, roleId: viewerRole.id })
      .expect(201);
    const companyUserId = createRes.body.id;

    await request(app.getHttpServer())
      .delete(`/iam/company-users/${companyUserId}`)
      .set(auth(ctx.accessToken))
      .expect(200);

    const stillExists = await prisma.user.findUnique({ where: { email: memberEmail } });
    expect(stillExists).not.toBeNull();
    const membershipGone = await prisma.companyUser.findFirst({ where: { id: companyUserId } });
    expect(membershipGone).toBeNull();

    // Login now issues a token with no active company (no memberships left) —
    // distinct from "wrong password", confirming access to THIS company is gone.
    const relogin = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: memberEmail, password: memberPassword })
      .expect(201);
    await request(app.getHttpServer())
      .get("/iam/company-users")
      .set(auth(relogin.body.accessToken))
      .expect(403);
  });

  it("an admin cannot suspend or remove their own access", async () => {
    const ctx = await setupUserWithCompany(app);
    const prisma = getPrisma(app);
    const selfMembership = await prisma.companyUser.findFirstOrThrow({ where: { companyId: ctx.companyId } });

    await request(app.getHttpServer())
      .patch(`/iam/company-users/${selfMembership.id}/status`)
      .set(auth(ctx.accessToken))
      .send({ status: "SUSPENDED" })
      .expect(400);
    await request(app.getHttpServer())
      .delete(`/iam/company-users/${selfMembership.id}`)
      .set(auth(ctx.accessToken))
      .expect(400);
  });
});
