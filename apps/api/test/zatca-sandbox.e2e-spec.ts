import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, createItem, createPartner, setupUserWithCompany } from "./utils/test-app";

/**
 * LIVE e2e against the ZATCA developer-portal sandbox
 * (https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal).
 *
 * Skipped unless ZATCA_SANDBOX_E2E=1 — requires outbound network access and
 * is excluded from normal runs/CI. This is where the XAdES byte-level quirks
 * are proven against ZATCA's real validator.
 */
const RUN_LIVE = process.env.ZATCA_SANDBOX_E2E === "1";
const d = RUN_LIVE ? describe : describe.skip;

d("ZATCA sandbox (live e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  jest.setTimeout(180000);

  async function setupOnboardedCompany() {
    const ctx = await setupUserWithCompany(app);
    await request(app.getHttpServer())
      .patch("/companies/current")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        taxRegistrationNumber: "310000000000003",
        crNumber: "1010101010",
        addressLine1: "King Fahd Road",
        buildingNumber: "1234",
        district: "Al Olaya",
        city: "Riyadh",
        postalCode: "12211",
      })
      .expect(200);

    const onboardRes = await request(app.getHttpServer())
      .post("/zatca/devices/onboard")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({ environment: "SANDBOX", unitName: "ERP-Live-Test", otp: "123345" })
      .expect(201);

    expect(onboardRes.body.device.status).toBe("ACTIVE");
    return ctx;
  }

  async function postInvoice(ctx: any, partnerId: string, itemId: string) {
    const today = new Date().toISOString();
    const draft = await request(app.getHttpServer())
      .post("/ar/invoices")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        businessPartnerId: partnerId,
        issueDateTime: today,
        postingDate: today,
        dueDate: today,
        lines: [{ itemId, description: "Live sandbox test", quantity: "1", unitPrice: "100" }],
      })
      .expect(201);
    return (
      await request(app.getHttpServer())
        .post(`/ar/invoices/${draft.body.id}/post`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(201)
    ).body;
  }

  it("onboards, clears a standard invoice, and reports a simplified invoice against the real sandbox", async () => {
    const ctx = await setupOnboardedCompany();

    const b2bCustomer = await createPartner(app, ctx.accessToken, "CUSTOMER", {
      taxRegistrationNumber: "311111111111113",
    });
    const b2cCustomer = await createPartner(app, ctx.accessToken, "CUSTOMER", {
      taxRegistrationNumber: undefined,
    });
    const item = await createItem(app, ctx.accessToken, { defaultSalesAccountId: ctx.accountByCode("4100").id });

    const b2bInvoice = await postInvoice(ctx, b2bCustomer.id, item.id);
    const b2bDetail = await request(app.getHttpServer())
      .get(`/ar/invoices/${b2bInvoice.id}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`);
    expect(["CLEARED", "FAILED"]).toContain(b2bDetail.body.zatcaSubmission.status);
    if (b2bDetail.body.zatcaSubmission.status !== "CLEARED") {
      // Surface ZATCA's validation output for debugging rather than hiding it
      const sub = await request(app.getHttpServer())
        .get(`/zatca/submissions/${b2bDetail.body.zatcaSubmission.id}`)
        .set("Authorization", `Bearer ${ctx.accessToken}`);
      throw new Error(`Clearance not CLEARED: ${JSON.stringify(sub.body.zatcaResponse)}`);
    }

    const b2cInvoice = await postInvoice(ctx, b2cCustomer.id, item.id);
    const b2cDetail = await request(app.getHttpServer())
      .get(`/ar/invoices/${b2cInvoice.id}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`);
    if (b2cDetail.body.zatcaSubmission.status !== "REPORTED") {
      const sub = await request(app.getHttpServer())
        .get(`/zatca/submissions/${b2cDetail.body.zatcaSubmission.id}`)
        .set("Authorization", `Bearer ${ctx.accessToken}`);
      throw new Error(`Reporting not REPORTED: ${JSON.stringify(sub.body.zatcaResponse)}`);
    }
    expect(b2cDetail.body.zatcaSubmission.qrCode).toBeTruthy();
  });
});
