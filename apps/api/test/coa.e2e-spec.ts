import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, setupUserWithCompany } from "./utils/test-app";

describe("Chart of Accounts — rename & Project Intelligence category (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("seeds costCategory correctly on the default COA template", async () => {
    const ctx = await setupUserWithCompany(app);
    expect(ctx.accountByCode("5101").costCategory).toBe("MATERIAL");
    expect(ctx.accountByCode("5104").costCategory).toBe("MATERIAL");
    expect(ctx.accountByCode("5102").costCategory).toBe("MACHINERY");
    expect(ctx.accountByCode("5103").costCategory).toBe("MACHINERY");
    expect(ctx.accountByCode("5215").costCategory).toBe("LABOR");
    expect(ctx.accountByCode("5107").costCategory).toBe("MACHINERY");
    expect(ctx.accountByCode("5108").costCategory).toBe("MATERIAL");
    expect(ctx.accountByCode("5109").costCategory).toBe("MATERIAL");
    expect(ctx.accountByCode("5110").costCategory).toBe("MATERIAL");
    expect(ctx.accountByCode("5200").costCategory).toBe("LABOR");
    expect(ctx.accountByCode("5250").costCategory).toBe("LABOR");
    expect(ctx.accountByCode("5260").costCategory).toBe("LABOR");
    expect(ctx.accountByCode("5270").costCategory).toBe("LABOR");
    expect(ctx.accountByCode("5220").costCategory).toBeNull();
  });

  it("renames an account and sets/clears its cost category via PATCH", async () => {
    const ctx = await setupUserWithCompany(app);
    const account = ctx.accountByCode("5107");

    const set = await request(app.getHttpServer())
      .patch(`/coa/accounts/${account.id}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({ name: "Site Transportation & Logistics", costCategory: "MATERIAL" })
      .expect(200);
    expect(set.body.name).toBe("Site Transportation & Logistics");
    expect(set.body.costCategory).toBe("MATERIAL");

    const cleared = await request(app.getHttpServer())
      .patch(`/coa/accounts/${account.id}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({ costCategory: null })
      .expect(200);
    expect(cleared.body.costCategory).toBeNull();
  });
});
