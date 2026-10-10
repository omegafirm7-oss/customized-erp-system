import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { asPlatformAdmin, createTestApp, setupUserWithCompany } from "./utils/test-app";

// Downloads/exports are limited to the platform admin account. The web app
// hides the buttons too, but this is the enforcement that actually counts:
// these routes serve files straight from the server.
describe("Download/export routes are platform-admin only (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const fakeId = "00000000-0000-0000-0000-000000000000";
  const routes = {
    expensesTemplate: "/ap/invoices/import/expenses/template",
    employeesTemplate: "/hr/employees/import/template",
    wpsFile: `/hr/payroll-runs/${fakeId}/wps-file`,
    registerCsv: `/hr/payroll-runs/${fakeId}/register.csv`,
    partnersTemplate: "/partners/import/template",
    zatcaXml: `/zatca/submissions/${fakeId}/xml`,
  };

  it("rejects a regular company user, even an Administrator, on every download route", async () => {
    const ctx = await setupUserWithCompany(app);
    for (const route of Object.values(routes)) {
      await request(app.getHttpServer()).get(route).set(auth(ctx.accessToken)).expect(403);
    }
  });

  it("lets the platform admin through the guard", async () => {
    const ctx = await setupUserWithCompany(app);
    const adminToken = await asPlatformAdmin(app, ctx);

    await request(app.getHttpServer()).get(routes.employeesTemplate).set(auth(adminToken)).expect(200);
    await request(app.getHttpServer()).get(routes.partnersTemplate).set(auth(adminToken)).expect(200);
    await request(app.getHttpServer()).get(routes.expensesTemplate).set(auth(adminToken)).expect(200);

    // The id-based routes pass the guard and then fail on the made-up id —
    // anything other than 403 proves the guard let the request through.
    for (const route of [routes.wpsFile, routes.registerCsv, routes.zatcaXml]) {
      const res = await request(app.getHttpServer()).get(route).set(auth(adminToken));
      expect(res.status).not.toBe(403);
    }
  });
});
