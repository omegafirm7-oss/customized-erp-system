import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, setupUserWithCompany, uniqueEmail, uniqueCode, getPrisma } from "./utils/test-app";

describe("Photo upload sessions — phone-to-desktop camera bridge (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates a session, accepts an unauthenticated phone upload, and lets the desktop collect it exactly once", async () => {
    const ctx = await setupUserWithCompany(app);

    const session = await request(app.getHttpServer())
      .post("/photo-upload-sessions")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(201);
    expect(session.body.token).toMatch(/^[a-f0-9]{64}$/);

    const token = session.body.token;

    // Public status check — no auth needed, mirrors what the phone page calls
    const before = await request(app.getHttpServer()).get(`/photo-upload-sessions/${token}/status`).expect(200);
    expect(before.body.status).toBe("PENDING");

    // The phone posts with zero auth
    await request(app.getHttpServer())
      .post(`/photo-upload-sessions/${token}/upload`)
      .attach("file", Buffer.from([0x89, 0x50, 0x4e, 0x47]), { filename: "receipt.png", contentType: "image/png" })
      .expect(201);

    const after = await request(app.getHttpServer()).get(`/photo-upload-sessions/${token}/status`).expect(200);
    expect(after.body.status).toBe("UPLOADED");

    // Collecting requires auth and returns the exact bytes
    const file = await request(app.getHttpServer())
      .get(`/photo-upload-sessions/${token}/file`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(file.headers["content-type"]).toBe("image/png");
    expect((file.body as Buffer).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);

    // Single-use: the session is gone after collection
    await request(app.getHttpServer()).get(`/photo-upload-sessions/${token}/status`).expect(404);
    await request(app.getHttpServer())
      .get(`/photo-upload-sessions/${token}/file`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(404);
  });

  it("rejects a second upload to an already-used session, a non-image file, and a made-up token", async () => {
    const ctx = await setupUserWithCompany(app);
    const session = await request(app.getHttpServer())
      .post("/photo-upload-sessions")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(201);
    const token = session.body.token;

    await request(app.getHttpServer())
      .post(`/photo-upload-sessions/${token}/upload`)
      .attach("file", Buffer.from([1, 2, 3]), { filename: "a.png", contentType: "image/png" })
      .expect(201);

    // Second upload to the same session is rejected
    await request(app.getHttpServer())
      .post(`/photo-upload-sessions/${token}/upload`)
      .attach("file", Buffer.from([4, 5, 6]), { filename: "b.png", contentType: "image/png" })
      .expect(409);

    // Non-image content type is rejected on a fresh session
    const session2 = await request(app.getHttpServer())
      .post("/photo-upload-sessions")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/photo-upload-sessions/${session2.body.token}/upload`)
      .attach("file", Buffer.from("not an image"), { filename: "a.pdf", contentType: "application/pdf" })
      .expect(400);

    // A made-up token is a clean 404, not a crash
    await request(app.getHttpServer()).get("/photo-upload-sessions/does-not-exist/status").expect(404);
  });

  it("isolates sessions across companies — one company's user can't collect another's photo", async () => {
    const a = await setupUserWithCompany(app);
    const b = await setupUserWithCompany(app);

    const session = await request(app.getHttpServer())
      .post("/photo-upload-sessions")
      .set("Authorization", `Bearer ${a.accessToken}`)
      .expect(201);
    const token = session.body.token;
    await request(app.getHttpServer())
      .post(`/photo-upload-sessions/${token}/upload`)
      .attach("file", Buffer.from([1]), { filename: "a.png", contentType: "image/png" })
      .expect(201);

    // Company B's token can't see company A's photo
    await request(app.getHttpServer())
      .get(`/photo-upload-sessions/${token}/file`)
      .set("Authorization", `Bearer ${b.accessToken}`)
      .expect(404);
  });

  it("requires authentication to create a session or collect a result", async () => {
    await request(app.getHttpServer()).post("/photo-upload-sessions").expect(401);
    await request(app.getHttpServer()).get("/photo-upload-sessions/anything/file").expect(401);
  });

  /**
   * A desktop tab left backgrounded (or fully suspended by the OS) while
   * the user is away on their phone can stop running JS entirely — no
   * client-side timer, however carefully designed, is guaranteed to keep
   * sending heartbeats through that. This proves the grace is real from
   * server-side DB state alone: a stale `lastActivityAt` normally revokes
   * the session, but doesn't when a pending PhotoUploadSession exists —
   * simulated here by backdating the timestamp directly, with zero
   * reliance on any client behavior.
   */
  it("keeps a session alive past the idle window when a phone-camera upload is pending, but still expires it when nothing is pending", async () => {
    const email = uniqueEmail("idle-grace");
    const password = "SuperSecret123!";
    await request(app.getHttpServer()).post("/auth/register").send({ email, password, fullName: "Idle Grace Test" }).expect(201);
    const prisma = getPrisma(app);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });

    // ── Baseline: no pending upload — a 6-minute-stale session (past the
    // 5-minute idle+warning window) is correctly revoked, same as today.
    const login1 = await request(app.getHttpServer()).post("/auth/login").send({ email, password }).expect(201);
    const cookies1 = login1.headers["set-cookie"];
    await prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { lastActivityAt: new Date(Date.now() - 6 * 60 * 1000) },
    });
    await request(app.getHttpServer()).post("/auth/heartbeat").set("Cookie", cookies1).expect(401);

    // ── With a pending photo upload: the same 6-minute-stale gap must NOT
    // revoke the session, on both server-side enforcement points.
    // POST /photo-upload-sessions requires an active company, which this
    // registered-but-companyless user doesn't have yet — create one and
    // re-login to pick up the scoped token, same as setupUserWithCompany.
    const preCompanyLogin = await request(app.getHttpServer()).post("/auth/login").send({ email, password }).expect(201);
    await request(app.getHttpServer())
      .post("/companies")
      .set("Authorization", `Bearer ${preCompanyLogin.body.accessToken}`)
      .send({ code: uniqueCode("CO"), legalName: "Idle Grace Co", countryCode: "SA", baseCurrency: "SAR" })
      .expect(201);

    const login2 = await request(app.getHttpServer()).post("/auth/login").send({ email, password }).expect(201);
    const cookies2 = login2.headers["set-cookie"];
    const accessToken2 = login2.body.accessToken;

    await request(app.getHttpServer())
      .post("/photo-upload-sessions")
      .set("Authorization", `Bearer ${accessToken2}`)
      .expect(201);

    await prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { lastActivityAt: new Date(Date.now() - 6 * 60 * 1000) },
    });

    // POST /auth/heartbeat (what the old client-side fix relied on)
    await request(app.getHttpServer()).post("/auth/heartbeat").set("Cookie", cookies2).expect(201);

    // POST /auth/refresh (what actually fires when the access token itself
    // expired while the tab was away and the interceptor silently retries)
    await request(app.getHttpServer()).post("/auth/refresh").set("Cookie", cookies2).expect(201);
  });

  /**
   * The first version of hasPendingPhotoUpload() only matched status
   * PENDING — which meant the grace switched off at exactly the moment it
   * mattered most. The real sequence is: phone uploads (session flips to
   * UPLOADED) → desktop's next poll notices → desktop makes its first
   * authenticated call in a while to fetch the file → THAT's when a stale
   * access token gets silently refreshed, and by then the session is no
   * longer PENDING. This reproduces that exact ordering.
   */
  it("keeps the grace alive through the UPLOADED-but-not-yet-collected window, not just PENDING", async () => {
    const email = uniqueEmail("idle-grace-uploaded");
    const password = "SuperSecret123!";
    await request(app.getHttpServer()).post("/auth/register").send({ email, password, fullName: "Idle Grace Uploaded Test" }).expect(201);
    const prisma = getPrisma(app);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });

    const preCompanyLogin = await request(app.getHttpServer()).post("/auth/login").send({ email, password }).expect(201);
    await request(app.getHttpServer())
      .post("/companies")
      .set("Authorization", `Bearer ${preCompanyLogin.body.accessToken}`)
      .send({ code: uniqueCode("CO"), legalName: "Idle Grace Uploaded Co", countryCode: "SA", baseCurrency: "SAR" })
      .expect(201);

    const login = await request(app.getHttpServer()).post("/auth/login").send({ email, password }).expect(201);
    const cookies = login.headers["set-cookie"];
    const accessToken = login.body.accessToken;

    const session = await request(app.getHttpServer())
      .post("/photo-upload-sessions")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(201);

    // The phone finishes — the session is now UPLOADED, not PENDING, and
    // the desktop hasn't collected it yet.
    await request(app.getHttpServer())
      .post(`/photo-upload-sessions/${session.body.token}/upload`)
      .attach("file", Buffer.from([1, 2, 3]), { filename: "receipt.png", contentType: "image/png" })
      .expect(201);

    await prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { lastActivityAt: new Date(Date.now() - 6 * 60 * 1000) },
    });

    // This is the desktop's first authenticated call since going stale —
    // exactly what fires right after noticing UPLOADED. Must not revoke.
    await request(app.getHttpServer()).post("/auth/refresh").set("Cookie", cookies).expect(201);
  });
});
