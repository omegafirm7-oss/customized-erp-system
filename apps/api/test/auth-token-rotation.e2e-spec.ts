import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, uniqueEmail, getPrisma } from "./utils/test-app";

/**
 * Regression coverage for a real production incident (2026-09-09): reuse of
 * an already-rotated refresh token used to revoke EVERY session the user had
 * — including a completely different, perfectly healthy device. In practice
 * one device (a phone with a long-stale cached session) would periodically
 * retry its dead refresh token, and each attempt silently logged the user
 * out of their desktop session too, with no relation to whatever the
 * desktop was actually doing. See feature_phone_camera_qr_upload_and_invoice_prefill
 * memory for the full incident writeup.
 */
describe("Refresh token rotation & reuse detection (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  function cookieOf(res: request.Response): string[] {
    return res.headers["set-cookie"] as unknown as string[];
  }

  it("rotates cleanly: the new token works, and using the old one again outside the grace window is treated as real reuse", async () => {
    const email = uniqueEmail("rotate-basic");
    const password = "SuperSecret123!";
    await request(app.getHttpServer()).post("/auth/register").send({ email, password, fullName: "Rotate Basic" }).expect(201);

    const login = await request(app.getHttpServer()).post("/auth/login").send({ email, password }).expect(201);
    const cookieA1 = cookieOf(login);

    const refreshed = await request(app.getHttpServer()).post("/auth/refresh").set("Cookie", cookieA1).expect(201);
    const cookieA2 = cookieOf(refreshed);

    // The new token works.
    await request(app.getHttpServer()).post("/auth/refresh").set("Cookie", cookieA2).expect(201);

    // Backdate A1's revocation so a replay falls outside the benign-race
    // grace window — this must be treated as a real reuse signal.
    const prisma = getPrisma(app);
    const tokenIdA1 = cookieA1[0].split("=")[1].split(".")[0].split(";")[0];
    await prisma.refreshToken.update({
      where: { id: tokenIdA1 },
      data: { revokedAt: new Date(Date.now() - 60 * 1000) },
    });

    await request(app.getHttpServer()).post("/auth/refresh").set("Cookie", cookieA1).expect(401);
  });

  it("treats a same-family reuse within the grace window as a benign race (two tabs refreshing near-simultaneously), not a compromise", async () => {
    const email = uniqueEmail("rotate-race");
    const password = "SuperSecret123!";
    await request(app.getHttpServer()).post("/auth/register").send({ email, password, fullName: "Rotate Race" }).expect(201);

    const login = await request(app.getHttpServer()).post("/auth/login").send({ email, password }).expect(201);
    const cookieA1 = cookieOf(login);

    // First tab rotates normally.
    await request(app.getHttpServer()).post("/auth/refresh").set("Cookie", cookieA1).expect(201);

    // A second tab, racing the first, presents the SAME original cookie —
    // already rotated moments ago. This must succeed with a fresh token,
    // not 401, and must not touch the sibling tab's just-issued session.
    const raced = await request(app.getHttpServer()).post("/auth/refresh").set("Cookie", cookieA1).expect(201);
    const cookieA3 = cookieOf(raced);

    // The token handed back to the race loser is itself fully live.
    await request(app.getHttpServer()).post("/auth/refresh").set("Cookie", cookieA3).expect(201);
  });

  it("scopes real reuse-detection revocation to the offending device's own family — a different device's session survives", async () => {
    const email = uniqueEmail("rotate-multidevice");
    const password = "SuperSecret123!";
    await request(app.getHttpServer()).post("/auth/register").send({ email, password, fullName: "Rotate Multi Device" }).expect(201);

    // Two independent logins simulate two devices — separate token families.
    const loginDeviceA = await request(app.getHttpServer()).post("/auth/login").send({ email, password }).expect(201);
    const cookieDeviceA1 = cookieOf(loginDeviceA);
    const loginDeviceB = await request(app.getHttpServer()).post("/auth/login").send({ email, password }).expect(201);
    const cookieDeviceB = cookieOf(loginDeviceB);

    // Device A rotates once.
    const refreshedA = await request(app.getHttpServer()).post("/auth/refresh").set("Cookie", cookieDeviceA1).expect(201);
    const cookieDeviceA2 = cookieOf(refreshedA);

    // Backdate device A's original token past the grace window, then replay
    // it — a real reuse signal for device A's family only.
    const prisma = getPrisma(app);
    const tokenIdA1 = cookieDeviceA1[0].split("=")[1].split(".")[0].split(";")[0];
    await prisma.refreshToken.update({
      where: { id: tokenIdA1 },
      data: { revokedAt: new Date(Date.now() - 60 * 1000) },
    });
    await request(app.getHttpServer()).post("/auth/refresh").set("Cookie", cookieDeviceA1).expect(401);

    // Device A's now-current token is dead too (family-wide revoke)...
    await request(app.getHttpServer()).post("/auth/refresh").set("Cookie", cookieDeviceA2).expect(401);

    // ...but device B, a totally different family for the same account,
    // must be completely unaffected — this is the exact production bug.
    await request(app.getHttpServer()).post("/auth/refresh").set("Cookie", cookieDeviceB).expect(201);
  });
});
