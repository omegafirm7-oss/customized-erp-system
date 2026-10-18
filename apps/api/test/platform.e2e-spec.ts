import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, getPrisma, setupUserWithCompany } from "./utils/test-app";
import { CLOUD_USAGE_PROVIDER, CloudUsageProvider } from "../src/platform/cloud-usage/cloud-usage.provider";

const fakeCloudUsageProvider: CloudUsageProvider = {
  getCost: async () => ({ monthToDateUsd: 0, currency: "USD", byService: [{ service: "COMPUTE", amountUsd: 0 }] }),
  getCompute: async () => ({ ocpusUsed: 1, memoryGbUsed: 6, instanceCount: 1 }),
  getBlockStorage: async () => ({ gbUsed: 46.6, volumeCount: 1 }),
  getLoadBalancerCount: async () => 0,
};

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

  async function promoteToPlatformAdmin(ctx: Awaited<ReturnType<typeof setupUserWithCompany>>): Promise<string> {
    const prisma = getPrisma(app);
    await prisma.user.update({ where: { email: ctx.email }, data: { isPlatformAdmin: true } });
    const relogged = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: ctx.email, password: ctx.password })
      .expect(201);
    return relogged.body.accessToken;
  }

  it("blocks a regular user from the cloud-usage route, and reports 'not configured' to a platform admin when no OCI env vars are set", async () => {
    const ctx = await setupUserWithCompany(app);
    await request(app.getHttpServer()).get("/platform/cloud-usage").set(auth(ctx.accessToken)).expect(403);

    const adminToken = await promoteToPlatformAdmin(ctx);
    const res = await request(app.getHttpServer()).get("/platform/cloud-usage").set(auth(adminToken)).expect(200);
    // The test environment has no OCI_* env vars — this app instance's
    // CLOUD_USAGE_PROVIDER factory resolves to null, and the service must
    // degrade to this shape rather than throwing.
    expect(res.body).toMatchObject({ configured: false, checkedAt: null, cost: null });
    expect(res.body.compute.status).toBe("ok");
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

describe("Platform admin cloud-usage (e2e, OCI configured via a fake provider)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    // A fake provider stands in for the real OCI SDK client — this tests
    // the service's own status/percent computation and response shaping,
    // not Oracle's wire format (see CloudUsageProvider interface).
    app = await createTestApp([{ provide: CLOUD_USAGE_PROVIDER, useValue: fakeCloudUsageProvider }]);
  });

  afterAll(async () => {
    await app.close();
  });

  it("shapes a live snapshot from the provider, with correct usage caps and status", async () => {
    const ctx = await setupUserWithCompany(app);
    const prisma = getPrisma(app);
    await prisma.user.update({ where: { email: ctx.email }, data: { isPlatformAdmin: true } });
    const relogged = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: ctx.email, password: ctx.password })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get("/platform/cloud-usage")
      .set({ Authorization: `Bearer ${relogged.body.accessToken}` })
      .expect(200);

    expect(res.body.configured).toBe(true);
    expect(res.body.checkedAt).not.toBeNull();
    expect(res.body.cost).toEqual({ monthToDateUsd: 0, currency: "USD", byService: [{ service: "COMPUTE", amountUsd: 0 }] });
    expect(res.body.compute).toMatchObject({ ocpusUsed: 1, ocpusCap: 4, memoryGbUsed: 6, memoryGbCap: 24, status: "ok" });
    expect(res.body.blockStorage).toMatchObject({ gbUsed: 46.6, gbCap: 200, volumeCount: 1, status: "ok" });
    expect(res.body.loadBalancers).toMatchObject({ count: 0, cap: 1, status: "ok" });
  });
});
