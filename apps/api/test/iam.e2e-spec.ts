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
});
