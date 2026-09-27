import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { MailService } from "../src/common/mail/mail.service";
import { OutreachService } from "../src/crm/agent/outreach.service";
import { createTestApp, getPrisma, grantModules, setupUserWithCompany } from "./utils/test-app";

describe("CRM sales agent — outreach, follow-ups, AI endpoints (e2e)", () => {
  let app: INestApplication;
  let mail: MailService;
  let sendSpy: jest.SpyInstance;

  beforeAll(async () => {
    app = await createTestApp();
    mail = app.get(MailService);
  });

  beforeEach(() => {
    jest.spyOn(mail, "isConfigured").mockReturnValue(true);
    sendSpy = jest.spyOn(mail, "sendOutreachEmail").mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  async function setupContext() {
    const ctx = await setupUserWithCompany(app);
    const accessToken = await grantModules(app, ctx, ["crm"]);
    return { ...ctx, accessToken };
  }

  async function createLead(token: string, body: Record<string, unknown> = {}) {
    return (
      await request(app.getHttpServer())
        .post("/crm/leads")
        .set(auth(token))
        .send({ name: "Eng. Khalid", companyName: "Gulf Scaffolding Co", email: "khalid@gulf.test", phone: "0551234567", ...body })
        .expect(201)
    ).body;
  }

  it("reports configuration and refuses AI calls cleanly when no API key is set", async () => {
    const ctx = await setupContext();
    const status = (await request(app.getHttpServer()).get("/crm/agent/status").set(auth(ctx.accessToken)).expect(200)).body;
    expect(status.aiConfigured).toBe(false);

    await request(app.getHttpServer())
      .post("/crm/agent/research")
      .set(auth(ctx.accessToken))
      .send({ service: "TUV cards", targetType: "SME contractors", city: "Jubail" })
      .expect(503);
    const lead = await createLead(ctx.accessToken);
    await request(app.getHttpServer())
      .post("/crm/agent/draft")
      .set(auth(ctx.accessToken))
      .send({ leadId: lead.id, channel: "WHATSAPP" })
      .expect(503);
  });

  it("stores the TUV sales fields on a lead", async () => {
    const ctx = await setupContext();
    const lead = await createLead(ctx.accessToken, {
      priority: "HOT",
      businessLines: ["training"],
      safetyCertsRequired: ["TUV Safety Card", "H2S Alive"],
      contractorGrade: "Grade 3",
      projectName: "Jubail Refinery Shutdown",
      city: "Jubail",
      estimatedValue: "45000",
    });
    expect(lead.priority).toBe("HOT");
    expect(lead.safetyCertsRequired).toEqual(["TUV Safety Card", "H2S Alive"]);
    expect(Number(lead.estimatedValue)).toBe(45000);

    const updated = (
      await request(app.getHttpServer())
        .patch(`/crm/leads/${lead.id}`)
        .set(auth(ctx.accessToken))
        .send({ priority: "COLD", businessLines: ["training", "manpower"] })
        .expect(200)
    ).body;
    expect(updated.priority).toBe("COLD");
    expect(updated.businessLines).toEqual(["training", "manpower"]);
    expect(updated.contractorGrade).toBe("Grade 3");
  });

  it("logs a WhatsApp message, normalizes the Saudi number, and schedules follow-ups", async () => {
    const ctx = await setupContext();
    const lead = await createLead(ctx.accessToken);

    const activity = (
      await request(app.getHttpServer())
        .post("/crm/agent/log-whatsapp")
        .set(auth(ctx.accessToken))
        .send({ leadId: lead.id, body: "Salam Khalid, TUV card batch next week?", scheduleFollowUps: true })
        .expect(201)
    ).body;
    expect(activity.type).toBe("WHATSAPP");
    expect(activity.recipient).toBe("966551234567");
    expect(activity.sentAt).toBeTruthy();

    const leadAfter = (await request(app.getHttpServer()).get(`/crm/leads/${lead.id}`).set(auth(ctx.accessToken)).expect(200)).body;
    expect(leadAfter.status).toBe("CONTACTED");
    expect(leadAfter.followUpDate).toBeTruthy();

    const followUps = (await request(app.getHttpServer()).get("/crm/agent/follow-ups").set(auth(ctx.accessToken)).expect(200)).body;
    expect(followUps).toHaveLength(2); // default cadence 3,7
    expect(followUps.every((f: any) => f.type === "WHATSAPP" && !f.autoSend)).toBe(true);
    expect(followUps[0].lead.id).toBe(lead.id);

    // Sending the first follow-up completes it in place
    await request(app.getHttpServer())
      .post("/crm/agent/log-whatsapp")
      .set(auth(ctx.accessToken))
      .send({ leadId: lead.id, body: "Just checking in", followUpActivityId: followUps[0].id })
      .expect(201);
    const remaining = (await request(app.getHttpServer()).get("/crm/agent/follow-ups").set(auth(ctx.accessToken)).expect(200)).body;
    expect(remaining).toHaveLength(1);
    // ...and can't be sent twice
    await request(app.getHttpServer())
      .post("/crm/agent/log-whatsapp")
      .set(auth(ctx.accessToken))
      .send({ leadId: lead.id, body: "again", followUpActivityId: followUps[0].id })
      .expect(409);

    // A lead with no phone can't be messaged
    const noPhone = await createLead(ctx.accessToken, { phone: undefined, companyName: "No Phone Co" });
    await request(app.getHttpServer())
      .post("/crm/agent/log-whatsapp")
      .set(auth(ctx.accessToken))
      .send({ leadId: noPhone.id, body: "hi" })
      .expect(400);
  });

  it("sends email with signature, auto-sends the due follow-up once, and stops chasing qualified leads", async () => {
    const ctx = await setupContext();
    await request(app.getHttpServer())
      .put("/crm/agent/settings")
      .set(auth(ctx.accessToken))
      .send({ companyProfile: "TVTC-accredited TUV card training in Dammam.", emailSignature: "Regards,\nSales Team", followUpDays: "1", autoSendEmailFollowUps: true })
      .expect(200);

    const lead = await createLead(ctx.accessToken);
    const second = await createLead(ctx.accessToken, { companyName: "Second Co", email: "second@co.test" });

    const sent = (
      await request(app.getHttpServer())
        .post("/crm/agent/send-email")
        .set(auth(ctx.accessToken))
        .send({ leadId: lead.id, subject: "TUV cards for your crew", body: "Dear Khalid,\n\nWe run weekly batches.", scheduleFollowUps: true })
        .expect(201)
    ).body;
    expect(sent.type).toBe("EMAIL");
    expect(sent.messageBody).toContain("Regards,\nSales Team");
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0][0].to).toBe("khalid@gulf.test");

    await request(app.getHttpServer())
      .post("/crm/agent/send-email")
      .set(auth(ctx.accessToken))
      .send({ leadId: second.id, subject: "TUV cards", body: "Hello", scheduleFollowUps: true })
      .expect(201);
    // Second lead gets qualified — its pending follow-up must not go out
    await request(app.getHttpServer()).patch(`/crm/leads/${second.id}`).set(auth(ctx.accessToken)).send({ status: "QUALIFIED" }).expect(200);

    const outreach = app.get(OutreachService);
    // Not due yet
    expect(await outreach.runAutoSendOnce(new Date())).toBe(0);

    const twoDaysLater = new Date(Date.now() + 2 * 86_400_000);
    sendSpy.mockClear();
    const count = await outreach.runAutoSendOnce(twoDaysLater);
    const prisma = getPrisma(app);
    const mine = await prisma.crmActivity.findMany({ where: { companyId: ctx.companyId, autoSend: true } });
    const leadFollowUp = mine.find((a) => a.leadId === lead.id)!;
    const secondFollowUp = mine.find((a) => a.leadId === second.id)!;
    expect(leadFollowUp.sentAt).toBeTruthy();
    expect(leadFollowUp.messageSubject).toBe("Re: TUV cards for your crew");
    expect(secondFollowUp.sentAt).toBeNull();
    expect(sendSpy.mock.calls.filter((c) => c[0].to === "khalid@gulf.test")).toHaveLength(1);
    expect(sendSpy.mock.calls.some((c) => c[0].to === "second@co.test")).toBe(false);
    expect(count).toBeGreaterThanOrEqual(1);

    // Re-running never double-sends
    sendSpy.mockClear();
    await outreach.runAutoSendOnce(twoDaysLater);
    expect(sendSpy.mock.calls.some((c) => c[0].to === "khalid@gulf.test")).toBe(false);

    const followUps = (await request(app.getHttpServer()).get("/crm/agent/follow-ups").set(auth(ctx.accessToken)).expect(200)).body;
    expect(followUps).toHaveLength(0);
  });

  it("surfaces an SMTP failure without recording the email as sent", async () => {
    const ctx = await setupContext();
    const lead = await createLead(ctx.accessToken);
    sendSpy.mockRejectedValueOnce(new Error("535 Authentication unsuccessful"));
    const res = await request(app.getHttpServer())
      .post("/crm/agent/send-email")
      .set(auth(ctx.accessToken))
      .send({ leadId: lead.id, subject: "Hi", body: "Hello" })
      .expect(400);
    expect(res.body.message).toContain("535");
    const activities = (await request(app.getHttpServer()).get("/crm/activities").query({ leadId: lead.id }).set(auth(ctx.accessToken)).expect(200)).body;
    expect(activities).toHaveLength(0);
  });

  it("imports researched leads, dropping 'not listed' placeholders", async () => {
    const ctx = await setupContext();
    const res = (
      await request(app.getHttpServer())
        .post("/crm/agent/import")
        .set(auth(ctx.accessToken))
        .send({
          city: "Jubail",
          businessLines: ["training"],
          leads: [
            { companyName: "Al Jubail Mechanical", phone: "+966 13 555 0000", email: "not listed", confidence: "HIGH", whyTheyNeedUs: "Aramco shutdown crews need cards" },
            { companyName: "Eastern Civil Works", phone: "not listed", email: "info@ecw.test", location: "Dammam", confidence: "MED" },
          ],
        })
        .expect(201)
    ).body;
    expect(res.created).toBe(2);
    const [a, b] = res.leads;
    expect(a.source).toBe("AI_RESEARCH");
    expect(a.priority).toBe("HOT");
    expect(a.email).toBeNull();
    expect(a.city).toBe("Jubail");
    expect(a.aiRationale).toContain("Aramco");
    expect(b.phone).toBeNull();
    expect(b.email).toBe("info@ecw.test");
    expect(b.city).toBe("Dammam");
    expect(b.businessLines).toEqual(["training"]);
  });

  it("embeds uploaded flyers in outreach email and keeps them company-scoped", async () => {
    const ctx = await setupContext();
    const other = await setupContext();
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a60000000049454e44ae426082", "hex");

    await request(app.getHttpServer())
      .post("/crm/agent/assets")
      .set(auth(ctx.accessToken))
      .attach("file", Buffer.from("RIFF....WEBP"), { filename: "flyer.webp", contentType: "image/webp" })
      .expect(400);
    const flyer = (
      await request(app.getHttpServer())
        .post("/crm/agent/assets")
        .set(auth(ctx.accessToken))
        .attach("file", png, { filename: "tuv-offer.png", contentType: "image/png" })
        .expect(201)
    ).body;
    expect(flyer.fileName).toBe("tuv-offer.png");
    expect(flyer.data).toBeUndefined();

    const list = (await request(app.getHttpServer()).get("/crm/agent/assets").set(auth(ctx.accessToken)).expect(200)).body;
    expect(list).toHaveLength(1);
    const file = await request(app.getHttpServer()).get(`/crm/agent/assets/${flyer.id}/file`).set(auth(ctx.accessToken)).expect(200);
    expect(file.headers["content-type"]).toBe("image/png");

    // Another company can neither see nor use it
    expect((await request(app.getHttpServer()).get("/crm/agent/assets").set(auth(other.accessToken)).expect(200)).body).toHaveLength(0);
    await request(app.getHttpServer()).get(`/crm/agent/assets/${flyer.id}/file`).set(auth(other.accessToken)).expect(404);
    const otherLead = await createLead(other.accessToken);
    await request(app.getHttpServer())
      .post("/crm/agent/send-email")
      .set(auth(other.accessToken))
      .send({ leadId: otherLead.id, subject: "x", body: "y", assetIds: [flyer.id] })
      .expect(400);

    const lead = await createLead(ctx.accessToken);
    const sent = (
      await request(app.getHttpServer())
        .post("/crm/agent/send-email")
        .set(auth(ctx.accessToken))
        .send({ leadId: lead.id, subject: "30% off TUV cards", body: "See our offer below.", assetIds: [flyer.id] })
        .expect(201)
    ).body;
    expect(sent.attachmentNames).toEqual(["tuv-offer.png"]);
    const call = sendSpy.mock.calls.at(-1)[0];
    expect(call.files).toHaveLength(1);
    expect(call.files[0].mimeType).toBe("image/png");
    expect(Buffer.compare(call.files[0].data, png)).toBe(0);

    await request(app.getHttpServer()).delete(`/crm/agent/assets/${flyer.id}`).set(auth(ctx.accessToken)).expect(200);
    expect((await request(app.getHttpServer()).get("/crm/agent/assets").set(auth(ctx.accessToken)).expect(200)).body).toHaveLength(0);
  });

  it("saves and clears the default outreach message and subject", async () => {
    const ctx = await setupContext();
    const message = "Dear {name},\n\nWe train crews.";
    const saved = (
      await request(app.getHttpServer())
        .put("/crm/agent/settings")
        .set(auth(ctx.accessToken))
        .send({ companyProfile: "Profile", defaultEmailSubject: " TUV cards for {company} ", defaultMessage: message, defaultWhatsappMessage: "Salam {name}!" })
        .expect(200)
    ).body;
    expect(saved.defaultWhatsappMessage).toBe("Salam {name}!");
    expect(saved.defaultEmailSubject).toBe("TUV cards for {company}");
    expect(saved.defaultMessage).toBe(message);
    const got = (await request(app.getHttpServer()).get("/crm/agent/settings").set(auth(ctx.accessToken)).expect(200)).body;
    expect(got.defaultMessage).toBe(message);
    const cleared = (
      await request(app.getHttpServer()).put("/crm/agent/settings").set(auth(ctx.accessToken)).send({ defaultMessage: "  " }).expect(200)
    ).body;
    expect(cleared.defaultMessage).toBeNull();
    expect(cleared.defaultEmailSubject).toBe("TUV cards for {company}");
  });

  it("isolates outreach between companies", async () => {
    const a = await setupContext();
    const b = await setupContext();
    const lead = await createLead(a.accessToken);
    await request(app.getHttpServer())
      .post("/crm/agent/send-email")
      .set(auth(b.accessToken))
      .send({ leadId: lead.id, subject: "x", body: "y" })
      .expect(404);
    await request(app.getHttpServer())
      .post("/crm/agent/log-whatsapp")
      .set(auth(b.accessToken))
      .send({ leadId: lead.id, body: "y" })
      .expect(404);
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
