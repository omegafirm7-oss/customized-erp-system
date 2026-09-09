import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, setupUserWithCompany } from "./utils/test-app";

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
});
