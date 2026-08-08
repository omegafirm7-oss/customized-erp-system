import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, createPartner, grantModules, setupUserWithCompany } from "./utils/test-app";

describe("CRM — Leads, Opportunities, Contacts, Activities (e2e)", () => {
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

  async function setupContext() {
    const ctx = await setupUserWithCompany(app);
    // New companies start with no premium modules entitled (see
    // module-entitlement.e2e-spec.ts) — this suite exercises the CRM
    // module's actual behavior, so grant it explicitly, as a platform
    // admin would via the Platform Dashboard.
    const accessToken = await grantModules(app, ctx, ["crm"]);
    return { ...ctx, accessToken };
  }

  it("blocks a company without the crm module even with valid permissions", async () => {
    const ctx = await setupUserWithCompany(app);
    await request(app.getHttpServer()).get("/crm/leads").set(auth(ctx.accessToken)).expect(403);
    await request(app.getHttpServer()).get("/crm/opportunities").set(auth(ctx.accessToken)).expect(403);
  });

  it("takes a lead through the full pipeline: create, log activities, qualify, convert to opportunity, win", async () => {
    const ctx = await setupContext();

    const lead = (
      await request(app.getHttpServer())
        .post("/crm/leads")
        .set(auth(ctx.accessToken))
        .send({ name: "Jane Prospect", companyName: "Prospect LLC", email: "jane@prospect.test", source: "REFERRAL" })
        .expect(201)
    ).body;
    expect(lead.status).toBe("NEW");

    const call = (
      await request(app.getHttpServer())
        .post("/crm/activities")
        .set(auth(ctx.accessToken))
        .send({ type: "CALL", subject: "Intro call", leadId: lead.id })
        .expect(201)
    ).body;
    expect(call.leadId).toBe(lead.id);

    const activitiesForLead = (
      await request(app.getHttpServer()).get("/crm/activities").query({ leadId: lead.id }).set(auth(ctx.accessToken)).expect(200)
    ).body;
    expect(activitiesForLead).toHaveLength(1);

    await request(app.getHttpServer())
      .patch(`/crm/leads/${lead.id}`)
      .set(auth(ctx.accessToken))
      .send({ status: "QUALIFIED" })
      .expect(200);

    const opportunity = (
      await request(app.getHttpServer())
        .post(`/crm/opportunities/from-lead/${lead.id}`)
        .set(auth(ctx.accessToken))
        .send({ name: "Prospect LLC — Initial deal", estimatedValue: "50000", probability: 40 })
        .expect(201)
    ).body;
    expect(opportunity.leadId).toBe(lead.id);
    expect(opportunity.stage).toBe("NEW");

    const leadAfter = (
      await request(app.getHttpServer()).get(`/crm/leads/${lead.id}`).set(auth(ctx.accessToken)).expect(200)
    ).body;
    expect(leadAfter.status).toBe("CONVERTED");
    expect(leadAfter.convertedOpportunityId).toBe(opportunity.id);

    // Converted leads are read-only
    await request(app.getHttpServer())
      .patch(`/crm/leads/${lead.id}`)
      .set(auth(ctx.accessToken))
      .send({ status: "NEW" })
      .expect(409);
    // And can't be converted a second time
    await request(app.getHttpServer())
      .post(`/crm/opportunities/from-lead/${lead.id}`)
      .set(auth(ctx.accessToken))
      .send({ name: "duplicate" })
      .expect(409);

    await request(app.getHttpServer())
      .patch(`/crm/opportunities/${opportunity.id}`)
      .set(auth(ctx.accessToken))
      .send({ stage: "PROPOSAL" })
      .expect(200);

    const won = (
      await request(app.getHttpServer()).post(`/crm/opportunities/${opportunity.id}/win`).set(auth(ctx.accessToken)).expect(201)
    ).body;
    expect(won.stage).toBe("WON");
    expect(won.probability).toBe(100);
    expect(won.wonAt).not.toBeNull();

    // Closed opportunities can't be edited or re-closed
    await request(app.getHttpServer())
      .patch(`/crm/opportunities/${opportunity.id}`)
      .set(auth(ctx.accessToken))
      .send({ stage: "PROPOSAL" })
      .expect(409);
    await request(app.getHttpServer()).post(`/crm/opportunities/${opportunity.id}/win`).set(auth(ctx.accessToken)).expect(409);
  });

  it("marks an opportunity lost with a reason", async () => {
    const ctx = await setupContext();
    const opportunity = (
      await request(app.getHttpServer())
        .post("/crm/opportunities")
        .set(auth(ctx.accessToken))
        .send({ name: "Doomed deal" })
        .expect(201)
    ).body;

    const lost = (
      await request(app.getHttpServer())
        .post(`/crm/opportunities/${opportunity.id}/lose`)
        .set(auth(ctx.accessToken))
        .send({ lostReason: "Budget cut" })
        .expect(201)
    ).body;
    expect(lost.stage).toBe("LOST");
    expect(lost.probability).toBe(0);
    expect(lost.lostReason).toBe("Budget cut");
  });

  it("manages contacts and activities linked to an existing business partner", async () => {
    const ctx = await setupContext();
    const partner = await createPartner(app, ctx.accessToken, "CUSTOMER");

    const contact = (
      await request(app.getHttpServer())
        .post("/crm/contacts")
        .set(auth(ctx.accessToken))
        .send({ businessPartnerId: partner.id, firstName: "Sam", lastName: "Buyer", isPrimary: true })
        .expect(201)
    ).body;
    expect(contact.businessPartnerId).toBe(partner.id);

    const contactsForPartner = (
      await request(app.getHttpServer())
        .get("/crm/contacts")
        .query({ businessPartnerId: partner.id })
        .set(auth(ctx.accessToken))
        .expect(200)
    ).body;
    expect(contactsForPartner).toHaveLength(1);

    await request(app.getHttpServer())
      .patch(`/crm/contacts/${contact.id}`)
      .set(auth(ctx.accessToken))
      .send({ jobTitle: "Procurement Manager" })
      .expect(200);

    const activity = (
      await request(app.getHttpServer())
        .post("/crm/activities")
        .set(auth(ctx.accessToken))
        .send({ type: "MEETING", subject: "Kickoff", businessPartnerId: partner.id })
        .expect(201)
    ).body;
    expect(activity.businessPartnerId).toBe(partner.id);

    const marked = (
      await request(app.getHttpServer())
        .patch(`/crm/activities/${activity.id}`)
        .set(auth(ctx.accessToken))
        .send({ completed: true })
        .expect(200)
    ).body;
    expect(marked.completedAt).not.toBeNull();

    await request(app.getHttpServer()).delete(`/crm/contacts/${contact.id}`).set(auth(ctx.accessToken)).expect(200);
  });

  it("rejects an activity with zero or multiple targets", async () => {
    const ctx = await setupContext();
    await request(app.getHttpServer())
      .post("/crm/activities")
      .set(auth(ctx.accessToken))
      .send({ type: "NOTE", subject: "orphan activity" })
      .expect(400);

    const lead = (
      await request(app.getHttpServer()).post("/crm/leads").set(auth(ctx.accessToken)).send({ name: "X" }).expect(201)
    ).body;
    const partner = await createPartner(app, ctx.accessToken, "CUSTOMER");
    await request(app.getHttpServer())
      .post("/crm/activities")
      .set(auth(ctx.accessToken))
      .send({ type: "NOTE", subject: "double target", leadId: lead.id, businessPartnerId: partner.id })
      .expect(400);
  });

  it("isolates leads and opportunities between companies", async () => {
    const a = await setupContext();
    await request(app.getHttpServer())
      .post("/crm/leads")
      .set(auth(a.accessToken))
      .send({ name: "A-only lead" })
      .expect(201);

    const b = await setupUserWithCompany(app);
    const bAccessToken = await grantModules(app, b, ["crm"]);
    const bLeads = (await request(app.getHttpServer()).get("/crm/leads").set(auth(bAccessToken)).expect(200)).body;
    expect(bLeads).toHaveLength(0);
  });
});
