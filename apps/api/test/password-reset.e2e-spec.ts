import { INestApplication } from "@nestjs/common";
import { createHash } from "crypto";
import request from "supertest";
import { createTestApp, getPrisma, setupUserWithCompany } from "./utils/test-app";
import { MailService } from "../src/common/mail/mail.service";

describe("Password reset (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Captures the raw token from the URL the app would have emailed, by
   * spying on MailService instead of actually sending — nothing else has
   * access to the raw token (only its hash is ever persisted). */
  function captureResetUrl(): { getUrl: () => string | undefined } {
    const spy = jest.spyOn(app.get(MailService), "sendPasswordResetEmail").mockResolvedValue(undefined);
    return { getUrl: () => spy.mock.calls[spy.mock.calls.length - 1]?.[1] };
  }

  it("responds identically whether or not the email is registered (no account enumeration)", async () => {
    const registeredRes = await request(app.getHttpServer())
      .post("/auth/forgot-password")
      .send({ email: "definitely-not-a-real-user@example.com" })
      .expect(201);
    const ctx = await setupUserWithCompany(app);
    const unregisteredRes = await request(app.getHttpServer()).post("/auth/forgot-password").send({ email: ctx.email }).expect(201);
    expect(registeredRes.body).toEqual(unregisteredRes.body);
  });

  it("only actually emails a link for a real, registered user", async () => {
    const { getUrl } = captureResetUrl();
    await request(app.getHttpServer()).post("/auth/forgot-password").send({ email: "no-such-user@example.com" }).expect(201);
    expect(getUrl()).toBeUndefined();

    const ctx = await setupUserWithCompany(app);
    await request(app.getHttpServer()).post("/auth/forgot-password").send({ email: ctx.email }).expect(201);
    expect(getUrl()).toContain("/reset-password?token=");
  });

  it("resets the password end-to-end: old password stops working, new one works, and other sessions are signed out", async () => {
    const ctx = await setupUserWithCompany(app);
    const { getUrl } = captureResetUrl();

    // Capture a refresh cookie from before the reset, to prove it gets revoked.
    const loginRes = await request(app.getHttpServer()).post("/auth/login").send({ email: ctx.email, password: ctx.password }).expect(201);
    const refreshCookieBeforeReset = loginRes.headers["set-cookie"][0];

    await request(app.getHttpServer()).post("/auth/forgot-password").send({ email: ctx.email }).expect(201);
    const url = getUrl();
    expect(url).toBeDefined();
    const token = new URL(url!).searchParams.get("token")!;

    const newPassword = "BrandNewPassword456!";
    await request(app.getHttpServer()).post("/auth/reset-password").send({ token, newPassword }).expect(201);

    // Old password now rejected.
    await request(app.getHttpServer()).post("/auth/login").send({ email: ctx.email, password: ctx.password }).expect(401);
    // New password works.
    await request(app.getHttpServer()).post("/auth/login").send({ email: ctx.email, password: newPassword }).expect(201);
    // The refresh token issued before the reset was revoked as part of it.
    await request(app.getHttpServer()).post("/auth/refresh").set("Cookie", refreshCookieBeforeReset).expect(401);
  });

  it("rejects reusing an already-used token", async () => {
    const ctx = await setupUserWithCompany(app);
    const { getUrl } = captureResetUrl();
    await request(app.getHttpServer()).post("/auth/forgot-password").send({ email: ctx.email }).expect(201);
    const token = new URL(getUrl()!).searchParams.get("token")!;

    await request(app.getHttpServer()).post("/auth/reset-password").send({ token, newPassword: "FirstReset123!" }).expect(201);
    await request(app.getHttpServer()).post("/auth/reset-password").send({ token, newPassword: "SecondReset123!" }).expect(400);
  });

  it("rejects an expired token", async () => {
    const ctx = await setupUserWithCompany(app);
    const { getUrl } = captureResetUrl();
    await request(app.getHttpServer()).post("/auth/forgot-password").send({ email: ctx.email }).expect(201);
    const token = new URL(getUrl()!).searchParams.get("token")!;

    const prisma = getPrisma(app);
    // Backdate the token's expiry rather than waiting 30 real minutes.
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await prisma.passwordResetToken.update({ where: { tokenHash }, data: { expiresAt: new Date(Date.now() - 1000) } });

    await request(app.getHttpServer())
      .post("/auth/reset-password")
      .send({ token, newPassword: "TooLateNow123!" })
      .expect(400);
  });

  it("rejects a bogus token", async () => {
    await request(app.getHttpServer())
      .post("/auth/reset-password")
      .send({ token: "not-a-real-token", newPassword: "WhateverPass123!" })
      .expect(400);
  });
});
