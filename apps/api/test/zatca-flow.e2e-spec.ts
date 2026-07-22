import { INestApplication } from "@nestjs/common";
import request from "supertest";
import * as jsrsasign from "jsrsasign";
import { ZatcaApiClient, ZatcaApiResult } from "../src/zatca/zatca-api.client";
import { generateCsr } from "../src/zatca/crypto/csr";
import { ZatcaEnvironment } from "@prisma/client";
import { createTestApp, createItem, createPartner, setupUserWithCompany } from "./utils/test-app";

/**
 * Mock-based e2e for the ZATCA flow: the real crypto/UBL pipeline runs, but
 * the HTTP client is replaced with a scriptable fake so no network access is
 * needed and failure modes are reproducible.
 */

function makeCertBase64(): string {
  const keys = generateCsr({
    environment: ZatcaEnvironment.SANDBOX,
    unitName: "FakeCA",
    organizationName: "Fake CA",
    organizationUnit: "CA",
    vatNumber: "310000000000003",
    registeredAddress: "Riyadh",
    businessCategory: "CA",
    solutionName: "CA",
    solutionVersion: "1",
  });
  const cert = new jsrsasign.KJUR.asn1.x509.Certificate({
    version: 3,
    serial: { int: 42 },
    issuer: { str: "/C=SA/O=ZATCA-Fake-CA/CN=FakeCA" },
    notbefore: "260101000000Z",
    notafter: "280101000000Z",
    subject: { str: "/C=SA/O=Test/CN=EGS" },
    sbjpubkey: keys.publicKeyPem,
    ext: [],
    sigalg: "SHA256withECDSA",
    cakey: keys.privateKeyPem,
  });
  return cert.getPEM().replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");
}

class FakeZatcaApiClient {
  certBase64 = makeCertBase64();
  /** Set to force the next N clearance/reporting calls to a specific outcome. */
  forcedOutcomes: ZatcaApiResult[] = [];
  lastClearancePayload: { invoiceHash: string; uuid: string; invoice: string } | null = null;
  complianceCheckCount = 0;

  private accepted(body: Record<string, unknown>): ZatcaApiResult {
    return { outcome: "ACCEPTED", httpStatus: 200, body };
  }

  async requestComplianceCsid(): Promise<ZatcaApiResult> {
    return this.accepted({ requestID: "REQ-123", binarySecurityToken: this.certBase64, secret: "compliance-secret" });
  }

  async complianceCheck(): Promise<ZatcaApiResult> {
    this.complianceCheckCount += 1;
    return this.accepted({ validationResults: { status: "PASS" } });
  }

  async requestProductionCsid(): Promise<ZatcaApiResult> {
    return this.accepted({ binarySecurityToken: this.certBase64, secret: "production-secret" });
  }

  async clearInvoice(_env: unknown, _cred: unknown, payload: { invoiceHash: string; uuid: string; invoice: string }): Promise<ZatcaApiResult> {
    this.lastClearancePayload = payload;
    const forced = this.forcedOutcomes.shift();
    if (forced) return forced;
    // Echo the submitted invoice back as the "cleared" document
    return this.accepted({ clearanceStatus: "CLEARED", clearedInvoice: payload.invoice, validationResults: { status: "PASS" } });
  }

  async reportInvoice(): Promise<ZatcaApiResult> {
    const forced = this.forcedOutcomes.shift();
    if (forced) return forced;
    return this.accepted({ reportingStatus: "REPORTED", validationResults: { status: "PASS" } });
  }
}

describe("ZATCA flow (mock e2e)", () => {
  let app: INestApplication;
  let fakeClient: FakeZatcaApiClient;

  beforeAll(async () => {
    fakeClient = new FakeZatcaApiClient();
    app = await createTestApp([{ provide: ZatcaApiClient, useValue: fakeClient }]);
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupZatcaCompany() {
    const ctx = await setupUserWithCompany(app);
    // Complete ZATCA-mandatory master data
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
    return ctx;
  }

  async function onboardDevice(ctx: Awaited<ReturnType<typeof setupZatcaCompany>>) {
    const res = await request(app.getHttpServer())
      .post("/zatca/devices/onboard")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({ environment: "SANDBOX", unitName: "Test-EGS-1" })
      .expect(201);
    return res.body;
  }

  async function postInvoice(ctx: any, partnerId: string, itemId: string, unitPrice = "1000") {
    const today = new Date().toISOString();
    const draft = await request(app.getHttpServer())
      .post("/ar/invoices")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        businessPartnerId: partnerId,
        issueDateTime: today,
        postingDate: today,
        dueDate: today,
        lines: [{ itemId, description: "Services", quantity: "1", unitPrice }],
      })
      .expect(201);
    const posted = await request(app.getHttpServer())
      .post(`/ar/invoices/${draft.body.id}/post`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(201);
    return posted.body;
  }

  it("onboards a device through the full state machine to ACTIVE", async () => {
    const ctx = await setupZatcaCompany();
    const result = await onboardDevice(ctx);

    expect(result.device.status).toBe("ACTIVE");
    expect(result.device.certificateExpiresAt).toBeTruthy();
    expect(result.device.icvCounter).toBe(0);
    // Secrets must never appear in API responses
    expect(JSON.stringify(result)).not.toContain("privateKeyEnc");
    expect(JSON.stringify(result)).not.toContain("SecretEnc");
    // Six compliance samples were submitted
    expect(fakeClient.complianceCheckCount).toBeGreaterThanOrEqual(6);
  });

  it("refuses onboarding when company master data is incomplete", async () => {
    const ctx = await setupUserWithCompany(app); // no ZATCA master data
    const res = await request(app.getHttpServer())
      .post("/zatca/devices/onboard")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({ environment: "SANDBOX", unitName: "Test-EGS-1" });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("master data incomplete");
  });

  it("clears a B2B invoice (buyer with TRN): STANDARD/CLEARANCE, cleared XML stored", async () => {
    const ctx = await setupZatcaCompany();
    await onboardDevice(ctx);
    const customer = await createPartner(app, ctx.accessToken, "CUSTOMER"); // has TRN
    const item = await createItem(app, ctx.accessToken, { defaultSalesAccountId: ctx.accountByCode("4100").id });

    const invoice = await postInvoice(ctx, customer.id, item.id);

    const detail = await request(app.getHttpServer())
      .get(`/ar/invoices/${invoice.id}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(200);

    expect(detail.body.zatcaSubmission).toBeTruthy();
    expect(detail.body.zatcaSubmission.invoiceKind).toBe("STANDARD");
    expect(detail.body.zatcaSubmission.status).toBe("CLEARED");
    expect(detail.body.zatcaSubmission.icv).toBe(1);

    // The XML download endpoint serves the cleared document
    const xmlRes = await request(app.getHttpServer())
      .get(`/zatca/submissions/${detail.body.zatcaSubmission.id}/xml`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(200);
    expect(xmlRes.text).toContain("<Invoice");
    expect(xmlRes.text).toContain("310000000000003");
  });

  it("reports a B2C invoice (no TRN): SIMPLIFIED with QR generated pre-submission", async () => {
    const ctx = await setupZatcaCompany();
    await onboardDevice(ctx);
    const customer = await createPartner(app, ctx.accessToken, "CUSTOMER", { taxRegistrationNumber: undefined });
    const item = await createItem(app, ctx.accessToken, { defaultSalesAccountId: ctx.accountByCode("4100").id });

    const invoice = await postInvoice(ctx, customer.id, item.id, "200");

    const detail = await request(app.getHttpServer())
      .get(`/ar/invoices/${invoice.id}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(200);

    expect(detail.body.zatcaSubmission.invoiceKind).toBe("SIMPLIFIED");
    expect(detail.body.zatcaSubmission.status).toBe("REPORTED");
    expect(detail.body.zatcaSubmission.qrCode).toBeTruthy();
    // QR is valid base64 TLV starting with tag 1
    const qrBuffer = Buffer.from(detail.body.zatcaSubmission.qrCode, "base64");
    expect(qrBuffer[0]).toBe(1);
  });

  it("transient failure → FAILED → manual retry → CLEARED; invoice stays POSTED throughout", async () => {
    const ctx = await setupZatcaCompany();
    await onboardDevice(ctx);
    const customer = await createPartner(app, ctx.accessToken, "CUSTOMER");
    const item = await createItem(app, ctx.accessToken, { defaultSalesAccountId: ctx.accountByCode("4100").id });

    fakeClient.forcedOutcomes.push({ outcome: "TRANSIENT_FAILURE", httpStatus: null, body: null, errorMessage: "ECONNRESET" });
    const invoice = await postInvoice(ctx, customer.id, item.id);
    expect(invoice.status).toBe("POSTED"); // accounting unaffected

    let detail = await request(app.getHttpServer())
      .get(`/ar/invoices/${invoice.id}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`);
    expect(detail.body.zatcaSubmission.status).toBe("FAILED");

    await request(app.getHttpServer())
      .post(`/zatca/submissions/${detail.body.zatcaSubmission.id}/retry`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(201);

    detail = await request(app.getHttpServer())
      .get(`/ar/invoices/${invoice.id}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`);
    expect(detail.body.zatcaSubmission.status).toBe("CLEARED");
  });

  it("REJECTED is terminal: errors stored, invoice remains POSTED, retry refused", async () => {
    const ctx = await setupZatcaCompany();
    await onboardDevice(ctx);
    const customer = await createPartner(app, ctx.accessToken, "CUSTOMER");
    const item = await createItem(app, ctx.accessToken, { defaultSalesAccountId: ctx.accountByCode("4100").id });

    fakeClient.forcedOutcomes.push({
      outcome: "REJECTED",
      httpStatus: 400,
      body: { validationResults: { errorMessages: [{ code: "BR-KSA-XX", message: "bad invoice" }] } },
    });
    const invoice = await postInvoice(ctx, customer.id, item.id);
    expect(invoice.status).toBe("POSTED");

    const detail = await request(app.getHttpServer())
      .get(`/ar/invoices/${invoice.id}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`);
    expect(detail.body.zatcaSubmission.status).toBe("REJECTED");
    expect(JSON.stringify(detail.body.zatcaSubmission.errors)).toContain("BR-KSA-XX");

    await request(app.getHttpServer())
      .post(`/zatca/submissions/${detail.body.zatcaSubmission.id}/retry`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(409);
  });

  it("standard invoice XML download is blocked until cleared", async () => {
    const ctx = await setupZatcaCompany();
    await onboardDevice(ctx);
    const customer = await createPartner(app, ctx.accessToken, "CUSTOMER");
    const item = await createItem(app, ctx.accessToken, { defaultSalesAccountId: ctx.accountByCode("4100").id });

    fakeClient.forcedOutcomes.push({ outcome: "TRANSIENT_FAILURE", httpStatus: null, body: null });
    const invoice = await postInvoice(ctx, customer.id, item.id);
    const detail = await request(app.getHttpServer())
      .get(`/ar/invoices/${invoice.id}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`);

    await request(app.getHttpServer())
      .get(`/zatca/submissions/${detail.body.zatcaSubmission.id}/xml`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(409);
  });

  it("credit note inherits the original invoice's kind and continues the ICV/PIH chain", async () => {
    const ctx = await setupZatcaCompany();
    await onboardDevice(ctx);
    const customer = await createPartner(app, ctx.accessToken, "CUSTOMER");
    const item = await createItem(app, ctx.accessToken, { defaultSalesAccountId: ctx.accountByCode("4100").id });

    const invoice = await postInvoice(ctx, customer.id, item.id);

    const cnDraft = await request(app.getHttpServer())
      .post("/ar/invoices")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        documentKind: "CREDIT_NOTE",
        originalInvoiceId: invoice.id,
        businessPartnerId: customer.id,
        issueDateTime: new Date().toISOString(),
        postingDate: new Date().toISOString(),
        dueDate: new Date().toISOString(),
        lines: [{ itemId: item.id, description: "Refund", quantity: "1", unitPrice: "100" }],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/ar/invoices/${cnDraft.body.id}/post`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(201);

    const invoiceDetail = await request(app.getHttpServer())
      .get(`/ar/invoices/${invoice.id}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`);
    const cnDetail = await request(app.getHttpServer())
      .get(`/ar/invoices/${cnDraft.body.id}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`);

    expect(cnDetail.body.zatcaSubmission.invoiceKind).toBe("STANDARD");
    expect(cnDetail.body.zatcaSubmission.icv).toBe(invoiceDetail.body.zatcaSubmission.icv + 1);

    // PIH chain: CN's previous hash = invoice's hash
    const submissions = await request(app.getHttpServer())
      .get("/zatca/submissions")
      .set("Authorization", `Bearer ${ctx.accessToken}`);
    const invoiceSub = submissions.body.find((s: any) => s.salesInvoiceId === invoice.id);
    const cnSubFull = await request(app.getHttpServer())
      .get(`/zatca/submissions/${cnDetail.body.zatcaSubmission.id}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`);
    expect(cnSubFull.body.previousInvoiceHash).toBe(invoiceSub.invoiceHash);
  });

  it("posting without an ACTIVE device skips ZATCA entirely", async () => {
    const ctx = await setupZatcaCompany(); // master data complete but NO device
    const customer = await createPartner(app, ctx.accessToken, "CUSTOMER");
    const item = await createItem(app, ctx.accessToken, { defaultSalesAccountId: ctx.accountByCode("4100").id });

    const invoice = await postInvoice(ctx, customer.id, item.id);
    expect(invoice.status).toBe("POSTED");

    const detail = await request(app.getHttpServer())
      .get(`/ar/invoices/${invoice.id}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`);
    expect(detail.body.zatcaSubmission).toBeNull();
  });

  it("assigns gapless ICVs with a correct PIH chain under concurrent posting", async () => {
    const ctx = await setupZatcaCompany();
    await onboardDevice(ctx);
    const customer = await createPartner(app, ctx.accessToken, "CUSTOMER");
    const item = await createItem(app, ctx.accessToken, { defaultSalesAccountId: ctx.accountByCode("4100").id });

    // Create 5 drafts, then post them all in parallel
    const draftIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const today = new Date().toISOString();
      const draft = await request(app.getHttpServer())
        .post("/ar/invoices")
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .send({
          businessPartnerId: customer.id,
          issueDateTime: today,
          postingDate: today,
          dueDate: today,
          lines: [{ itemId: item.id, description: `Line ${i}`, quantity: "1", unitPrice: "100" }],
        })
        .expect(201);
      draftIds.push(draft.body.id);
    }

    await Promise.all(
      draftIds.map((id) =>
        request(app.getHttpServer())
          .post(`/ar/invoices/${id}/post`)
          .set("Authorization", `Bearer ${ctx.accessToken}`)
          .expect(201),
      ),
    );

    const submissions = await request(app.getHttpServer())
      .get("/zatca/submissions")
      .set("Authorization", `Bearer ${ctx.accessToken}`);

    const icvs = submissions.body.map((s: any) => s.icv).sort((a: number, b: number) => a - b);
    expect(icvs).toEqual([1, 2, 3, 4, 5]);

    // PIH chain: each submission's previousInvoiceHash = predecessor's invoiceHash
    const fullSubs = await Promise.all(
      submissions.body.map(async (s: any) => {
        const full = await request(app.getHttpServer())
          .get(`/zatca/submissions/${s.id}`)
          .set("Authorization", `Bearer ${ctx.accessToken}`);
        return full.body;
      }),
    );
    fullSubs.sort((a, b) => a.icv - b.icv);
    for (let i = 1; i < fullSubs.length; i++) {
      expect(fullSubs[i].previousInvoiceHash).toBe(fullSubs[i - 1].invoiceHash);
    }
  });
});
