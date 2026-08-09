import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, setupUserWithCompany } from "./utils/test-app";

describe("Template settings (e2e)", () => {
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

  it("lazily provisions a default row on first read, then updates it", async () => {
    const ctx = await setupUserWithCompany(app);

    const initial = (await request(app.getHttpServer()).get("/settings/templates").set(auth(ctx.accessToken)).expect(200)).body;
    expect(initial.accentColor).toBe("#101828");
    expect(initial.hasLogo).toBe(false);
    expect(initial.timesheetTitle).toBe("Monthly Timesheet");

    const updated = (
      await request(app.getHttpServer())
        .patch("/settings/templates")
        .set(auth(ctx.accessToken))
        .send({
          accentColor: "#2563eb",
          footerText: "Thank you for your business",
          timesheetTitle: "Attendance Sheet",
          salesShowVatBreakdown: false,
        })
        .expect(200)
    ).body;
    expect(updated.accentColor).toBe("#2563eb");
    expect(updated.footerText).toBe("Thank you for your business");
    expect(updated.timesheetTitle).toBe("Attendance Sheet");
    expect(updated.salesShowVatBreakdown).toBe(false);
    // untouched fields survive a partial PATCH
    expect(updated.purchaseShowVatBreakdown).toBe(true);

    const refetched = (await request(app.getHttpServer()).get("/settings/templates").set(auth(ctx.accessToken)).expect(200)).body;
    expect(refetched.accentColor).toBe("#2563eb");
  });

  it("uploads, serves, and removes a company logo", async () => {
    const ctx = await setupUserWithCompany(app);
    // 1x1 transparent PNG
    const pngBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );

    await request(app.getHttpServer())
      .post("/settings/templates/logo")
      .set(auth(ctx.accessToken))
      .attach("file", pngBytes, { filename: "logo.png", contentType: "image/png" })
      .expect(201);

    const afterUpload = (await request(app.getHttpServer()).get("/settings/templates").set(auth(ctx.accessToken)).expect(200)).body;
    expect(afterUpload.hasLogo).toBe(true);
    expect(afterUpload.logoMimeType).toBe("image/png");

    const logoRes = await request(app.getHttpServer()).get("/settings/templates/logo").set(auth(ctx.accessToken)).expect(200);
    expect(logoRes.headers["content-type"]).toBe("image/png");
    expect(logoRes.body.length).toBe(pngBytes.length);

    await request(app.getHttpServer()).delete("/settings/templates/logo").set(auth(ctx.accessToken)).expect(200);
    const afterRemove = (await request(app.getHttpServer()).get("/settings/templates").set(auth(ctx.accessToken)).expect(200)).body;
    expect(afterRemove.hasLogo).toBe(false);
    await request(app.getHttpServer()).get("/settings/templates/logo").set(auth(ctx.accessToken)).expect(404);
  });

  it("scopes template settings per company — a second company gets its own default row", async () => {
    const ctxA = await setupUserWithCompany(app);
    const ctxB = await setupUserWithCompany(app);

    await request(app.getHttpServer())
      .patch("/settings/templates")
      .set(auth(ctxA.accessToken))
      .send({ accentColor: "#ff0000" })
      .expect(200);

    const companyB = (await request(app.getHttpServer()).get("/settings/templates").set(auth(ctxB.accessToken)).expect(200)).body;
    expect(companyB.accentColor).toBe("#101828");
  });
});
