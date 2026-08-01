import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, getPrisma, setupUserWithCompany } from "./utils/test-app";

describe("Platform admin dashboard (e2e)", () => {
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

  it("blocks a regular (non-platform-admin) user from both platform routes", async () => {
    const ctx = await setupUserWithCompany(app);

    await request(app.getHttpServer()).get("/platform/summary").set(auth(ctx.accessToken)).expect(403);
    await request(app.getHttpServer()).get("/platform/clients").set(auth(ctx.accessToken)).expect(403);
  });

  it("a platform admin sees aggregated counts across multiple tenant companies, and only sees this via the flag — not via any company membership", async () => {
    const prisma = getPrisma(app);

    // Two independent tenants, unrelated to each other and to the admin.
    const clientA = await setupUserWithCompany(app);
    const clientB = await setupUserWithCompany(app);

    // A third user with no company membership at all, promoted to platform
    // admin — proving the dashboard doesn't require @CurrentCompanyId().
    const admin = await setupUserWithCompany(app);
    await prisma.user.update({ where: { email: admin.email }, data: { isPlatformAdmin: true } });
    const reloggedAdmin = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: admin.email, password: admin.password })
      .expect(201);
    const adminToken: string = reloggedAdmin.body.accessToken;

    const summaryRes = await request(app.getHttpServer())
      .get("/platform/summary")
      .set(auth(adminToken))
      .expect(200);
    expect(summaryRes.body.totalClients).toBeGreaterThanOrEqual(3); // clientA, clientB, admin's own company
    expect(summaryRes.body.totalUsers).toBeGreaterThanOrEqual(3);
    expect(typeof summaryRes.body.storageUsedPercent).toBe("number");

    const clientsRes = await request(app.getHttpServer())
      .get("/platform/clients")
      .set(auth(adminToken))
      .expect(200);
    const codes = clientsRes.body.map((c: any) => c.id);
    // The dashboard sees tenants the admin has no membership in whatsoever —
    // this is the cross-tenant assertion that matters most here.
    const adminMembershipCompanyIds = (
      await prisma.companyUser.findMany({ where: { userId: (await prisma.user.findUniqueOrThrow({ where: { email: admin.email } })).id } })
    ).map((m) => m.companyId);
    expect(adminMembershipCompanyIds).not.toContain(clientA.companyId);
    expect(codes).toContain(clientA.companyId);
    expect(codes).toContain(clientB.companyId);

    // A regular Administrator of clientA's own company — even with full
    // in-company permissions — still can't reach the platform routes.
    await request(app.getHttpServer()).get("/platform/summary").set(auth(clientA.accessToken)).expect(403);
  });
});
