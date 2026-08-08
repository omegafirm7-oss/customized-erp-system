import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, getPrisma, grantModules, setupUserWithCompany } from "./utils/test-app";

describe("Module entitlement (e2e)", () => {
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

  it("blocks a freshly-created company (no modules entitled) from the Purchase controllers even with valid permissions", async () => {
    const ctx = await setupUserWithCompany(app);
    // Administrator role — has AP_QUOTATION_VIEW/AP_ORDER_VIEW — but the
    // company itself hasn't been entitled to "purchase" yet.
    await request(app.getHttpServer()).get("/ap/quotations").set(auth(ctx.accessToken)).expect(403);
    await request(app.getHttpServer()).get("/ap/orders").set(auth(ctx.accessToken)).expect(403);
  });

  it("grants access once the platform admin entitles the company to purchase, and revokes it on the next login after removal", async () => {
    const ctx = await setupUserWithCompany(app);

    const grantedToken = await grantModules(app, ctx, ["purchase"]);
    await request(app.getHttpServer()).get("/ap/quotations").set(auth(grantedToken)).expect(200);

    const revokedToken = await grantModules(app, ctx, []);
    await request(app.getHttpServer()).get("/ap/quotations").set(auth(revokedToken)).expect(403);
  });

  it("a platform admin bypasses module entitlement entirely, regardless of the active company's enabledModules", async () => {
    const prisma = getPrisma(app);
    const admin = await setupUserWithCompany(app);
    await prisma.user.update({ where: { email: admin.email }, data: { isPlatformAdmin: true } });
    // Explicitly confirm the company itself has nothing entitled.
    await prisma.company.update({ where: { id: admin.companyId }, data: { enabledModules: [] } });

    const relogin = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: admin.email, password: admin.password })
      .expect(201);
    const adminToken: string = relogin.body.accessToken;

    await request(app.getHttpServer()).get("/ap/quotations").set(auth(adminToken)).expect(200);
  });

  it("PATCH /platform/clients/:id/modules updates entitlement and is itself platform-admin-only", async () => {
    const prisma = getPrisma(app);
    const client = await setupUserWithCompany(app);
    const admin = await setupUserWithCompany(app);
    await prisma.user.update({ where: { email: admin.email }, data: { isPlatformAdmin: true } });
    const relogin = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: admin.email, password: admin.password })
      .expect(201);
    const adminToken: string = relogin.body.accessToken;

    // A non-platform-admin (even the client's own Administrator) can't self-grant.
    await request(app.getHttpServer())
      .patch(`/platform/clients/${client.companyId}/modules`)
      .set(auth(client.accessToken))
      .send({ enabledModules: ["purchase", "crm"] })
      .expect(403);

    const patchRes = await request(app.getHttpServer())
      .patch(`/platform/clients/${client.companyId}/modules`)
      .set(auth(adminToken))
      .send({ enabledModules: ["purchase", "crm"] })
      .expect(200);
    expect(patchRes.body.enabledModules.sort()).toEqual(["crm", "purchase"]);

    await request(app.getHttpServer())
      .patch(`/platform/clients/${client.companyId}/modules`)
      .set(auth(adminToken))
      .send({ enabledModules: ["not-a-real-module"] })
      .expect(400);
  });
});
