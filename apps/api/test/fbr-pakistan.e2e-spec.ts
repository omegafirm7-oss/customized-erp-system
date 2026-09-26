import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, getPrisma, setupUserWithCompany, uniqueCode, uniqueEmail } from "./utils/test-app";
import { FbrApiClient } from "../src/fbr/fbr-api.client";
import { FbrSubmissionService } from "../src/fbr/fbr-submission.service";

/**
 * Pakistan localization + FBR (Digital Invoicing and POS Integration),
 * end to end against the in-process MOCK FBR. Proves: PK tax math on real
 * postings, the GL, the DI/POS payloads, failure handling (FBR rejection,
 * outage → retry, auth), POS idempotency/returns/fees/API keys, and that
 * Saudi companies are untouched.
 */
describe("Pakistan / FBR (e2e)", () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication["getHttpServer"]>;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function setupPakistanCompany() {
    const email = uniqueEmail("pkuser");
    const password = "SuperSecret123!";
    await request(server).post("/auth/register").send({ email, password, fullName: "PK User" }).expect(201);
    const first = await request(server).post("/auth/login").send({ email, password }).expect(201);
    const companyRes = await request(server)
      .post("/companies")
      .set(auth(first.body.accessToken))
      .send({ code: uniqueCode("PK"), legalName: "Lahore Traders (Pvt) Ltd", countryCode: "PK", baseCurrency: "PKR" })
      .expect(201);
    const companyId: string = companyRes.body.id;
    await getPrisma(app).company.update({ where: { id: companyId }, data: { enabledModules: ["fbr", "sales"] } });
    const login = await request(server).post("/auth/login").send({ email, password }).expect(201);
    const token: string = login.body.accessToken;

    await request(server)
      .patch("/companies/current")
      .set(auth(token))
      .send({ ntn: "1234567", strn: "3277876123456", province: "PUNJAB", fbrBusinessActivity: "Wholesaler", fbrSector: "All Other Sectors", addressLine1: "Mall Road", city: "Lahore" })
      .expect(200);

    const accounts = (await request(server).get("/coa/accounts").set(auth(token)).expect(200)).body;
    const acct = (code: string) => accounts.find((a: any) => a.code === code);

    await request(server)
      .put("/fbr/settings")
      .set(auth(token))
      .send({ enabled: true, environment: "MOCK", posFeeAccountId: acct("2300").id })
      .expect(200);

    const uom = (await request(server).post("/uoms").set(auth(token)).send({ code: uniqueCode("PC"), name: "Piece" }).expect(201)).body;
    const item = (
      await request(server)
        .post("/items")
        .set(auth(token))
        .send({
          code: uniqueCode("FAN"),
          name: "Ceiling Fan",
          itemType: "SERVICE",
          baseUoMId: uom.id,
          hsCode: "8414.5100",
          defaultSalesAccountId: acct("4100").id,
        })
        .expect(201)
    ).body;

    const customer = async (overrides: Record<string, unknown>) =>
      (
        await request(server)
          .post("/partners")
          .set(auth(token))
          .send({ code: uniqueCode("C"), name: "Karachi Distributors", partnerType: "CUSTOMER", province: "SINDH", ...overrides })
          .expect(201)
      ).body;

    return { email, password, token, companyId, acct, uom, item, customer };
  }

  async function postInvoice(token: string, body: Record<string, unknown>, expectStatus = 201) {
    const today = new Date().toISOString();
    const draft = await request(server)
      .post("/ar/invoices")
      .set(auth(token))
      .send({ issueDateTime: today, postingDate: today, dueDate: today, ...body })
      .expect(201);
    const posted = await request(server).post(`/ar/invoices/${draft.body.id}/post`).set(auth(token)).expect(expectStatus);
    return { draft: draft.body, posted: posted.body };
  }

  function submissionFor(invoiceId: string) {
    return getPrisma(app).fbrSubmission.findUnique({ where: { salesInvoiceId: invoiceId } });
  }

  // ── Company setup ──────────────────────────────────────────────────

  it("provisions PK companies on the July–June tax year and defaults items to PK_STANDARD", async () => {
    const ctx = await setupPakistanCompany();
    const years = await getPrisma(app).fiscalYear.findMany({ where: { companyId: ctx.companyId } });
    expect(years).toHaveLength(1);
    expect(years[0].startDate.getUTCMonth()).toBe(6); // July
    expect(years[0].code).toMatch(/^FY\d{4}-\d{2}$/);
    expect(ctx.item.vatCategory).toBe("PK_STANDARD");

    // SA-only category is refused for a PK company
    await request(server)
      .post("/items")
      .set(auth(ctx.token))
      .send({ code: uniqueCode("X"), name: "Bad", itemType: "SERVICE", baseUoMId: ctx.uom.id, vatCategory: "STANDARD_15" })
      .expect(400);
  });

  // ── Digital Invoicing ──────────────────────────────────────────────

  it("reports a registered-buyer invoice to FBR DI and gets an FBR invoice number", async () => {
    const ctx = await setupPakistanCompany();
    const buyer = await ctx.customer({ ntnCnic: "7654321", fbrRegistrationType: "REGISTERED" });
    const { draft, posted } = await postInvoice(ctx.token, {
      businessPartnerId: buyer.id,
      lines: [{ itemId: ctx.item.id, description: "Ceiling Fan", quantity: "10", unitPrice: "100" }],
    });

    expect(Number(draft.vatTotal)).toBe(180); // 18% of 1000
    expect(Number(draft.furtherTaxTotal)).toBe(0);
    expect(posted.status).toBe("POSTED");

    const submission = await submissionFor(posted.id);
    expect(submission?.channel).toBe("DI");
    expect(submission?.status).toBe("VALID");
    expect(submission?.fbrInvoiceNumber).toMatch(/^1234567DI\d{13}\d$/);
    const payload = submission?.requestJson as any;
    expect(payload.buyerRegistrationType).toBe("Registered");
    expect(payload.scenarioId).toBe("SN001");
    expect(payload.items[0]).toMatchObject({ hsCode: "8414.5100", rate: "18%", valueSalesExcludingST: 1000, salesTaxApplicable: 180, furtherTax: 0 });

    const list = await request(server).get("/fbr/submissions").set(auth(ctx.token)).expect(200);
    expect(list.body[0].salesInvoice.invoiceNumber).toBe(posted.invoiceNumber);
  });

  it("charges further tax to unregistered buyers and books it to output tax", async () => {
    const ctx = await setupPakistanCompany();
    const buyer = await ctx.customer({ fbrRegistrationType: "UNREGISTERED" });
    const { draft, posted } = await postInvoice(ctx.token, {
      businessPartnerId: buyer.id,
      lines: [{ itemId: ctx.item.id, description: "Ceiling Fan", quantity: "10", unitPrice: "100" }],
    });
    expect(Number(draft.vatTotal)).toBe(220); // 180 ST + 40 FT (4%)
    expect(Number(draft.furtherTaxTotal)).toBe(40);
    expect(Number(draft.grossTotal)).toBe(1220);

    const je = await request(server).get(`/gl/journal-entries/${posted.journalEntryId}`).set(auth(ctx.token)).expect(200);
    const byCode = (code: string) => je.body.lines.find((l: any) => l.account.code === code);
    expect(Number(byCode("2200").credit)).toBe(220);
    expect(Number(byCode("4100").credit)).toBe(1000);

    const submission = await submissionFor(posted.id);
    expect(submission?.status).toBe("VALID");
    const item = (submission?.requestJson as any).items[0];
    expect(item.salesTaxApplicable).toBe(180);
    expect(item.furtherTax).toBe(40);
    expect((submission?.requestJson as any).scenarioId).toBe("SN002");
  });

  it("blocks posting (invoice stays DRAFT) when master data would make FBR reject it", async () => {
    const ctx = await setupPakistanCompany();
    const buyer = await ctx.customer({ fbrRegistrationType: "REGISTERED" }); // registered but no NTN
    const noHs = (
      await request(server)
        .post("/items")
        .set(auth(ctx.token))
        .send({ code: uniqueCode("NOHS"), name: "No HS", itemType: "SERVICE", baseUoMId: ctx.uom.id, defaultSalesAccountId: ctx.acct("4100").id })
        .expect(201)
    ).body;
    const today = new Date().toISOString();
    const draft = await request(server)
      .post("/ar/invoices")
      .set(auth(ctx.token))
      .send({ businessPartnerId: buyer.id, issueDateTime: today, postingDate: today, dueDate: today, lines: [{ itemId: noHs.id, description: "x", quantity: "1", unitPrice: "10" }] })
      .expect(201);
    const res = await request(server).post(`/ar/invoices/${draft.body.id}/post`).set(auth(ctx.token)).expect(400);
    expect(res.body.message).toMatch(/HS code/);
    expect(res.body.message).toMatch(/no NTN\/CNIC/);
    const after = await getPrisma(app).salesInvoice.findUnique({ where: { id: draft.body.id } });
    expect(after?.status).toBe("DRAFT");
    expect(after?.journalEntryId).toBeNull();
  });

  it("keeps the invoice POSTED when FBR rejects it, and a data fix + retry clears it", async () => {
    const ctx = await setupPakistanCompany();
    const buyer = await ctx.customer({ ntnCnic: "7654321", fbrRegistrationType: "REGISTERED" });
    // A province FBR doesn't recognise (only reachable by bad legacy data).
    await getPrisma(app).businessPartner.update({ where: { id: buyer.id }, data: { province: "LAHORE" } });
    const { posted } = await postInvoice(ctx.token, {
      businessPartnerId: buyer.id,
      lines: [{ itemId: ctx.item.id, description: "Ceiling Fan", quantity: "1", unitPrice: "500" }],
    });
    expect(posted.status).toBe("POSTED");
    let submission = await submissionFor(posted.id);
    expect(submission?.status).toBe("INVALID");
    expect((submission?.errors as any)[0].code).toBe("0074");

    await request(server).patch(`/partners/${buyer.id}`).set(auth(ctx.token)).send({ province: "PUNJAB" }).expect(200);
    const retried = await request(server).post(`/fbr/submissions/${submission!.id}/retry`).set(auth(ctx.token)).expect(201);
    expect(retried.body.status).toBe("VALID");
    submission = await submissionFor(posted.id);
    expect((submission?.requestJson as any).buyerProvince).toBe("PUNJAB");
  });

  it("survives an FBR outage: submission stays PENDING, the retrier later gets it accepted", async () => {
    const ctx = await setupPakistanCompany();
    const buyer = await ctx.customer({ ntnCnic: "7654321", fbrRegistrationType: "REGISTERED" });
    app.get(FbrApiClient).simulateOutage(1);
    const { posted } = await postInvoice(ctx.token, {
      businessPartnerId: buyer.id,
      lines: [{ itemId: ctx.item.id, description: "Ceiling Fan", quantity: "1", unitPrice: "500" }],
    });
    expect(posted.status).toBe("POSTED");
    expect((await submissionFor(posted.id))?.status).toBe("PENDING");

    // Backoff: first retry is due 1 minute after the failed attempt.
    await app.get(FbrSubmissionService).retryDue(new Date(Date.now() + 2 * 60_000));
    const after = await submissionFor(posted.id);
    expect(after?.status).toBe("VALID");
    expect(after?.retryCount).toBe(2);
  });

  it("marks auth failures FAILED (token problem), not INVALID", async () => {
    const ctx = await setupPakistanCompany();
    const buyer = await ctx.customer({ ntnCnic: "7654321", fbrRegistrationType: "REGISTERED" });
    app.get(FbrApiClient).simulateAuthFailure(1);
    const { posted } = await postInvoice(ctx.token, {
      businessPartnerId: buyer.id,
      lines: [{ itemId: ctx.item.id, description: "Ceiling Fan", quantity: "1", unitPrice: "500" }],
    });
    expect((await submissionFor(posted.id))?.status).toBe("FAILED");
  });

  it("reports credit notes as a note referencing the original FBR invoice number", async () => {
    const ctx = await setupPakistanCompany();
    const buyer = await ctx.customer({ ntnCnic: "7654321", fbrRegistrationType: "REGISTERED" });
    const { posted: original } = await postInvoice(ctx.token, {
      businessPartnerId: buyer.id,
      lines: [{ itemId: ctx.item.id, description: "Ceiling Fan", quantity: "2", unitPrice: "500" }],
    });
    const originalFbr = (await submissionFor(original.id))!.fbrInvoiceNumber;
    const { posted: credit } = await postInvoice(ctx.token, {
      documentKind: "CREDIT_NOTE",
      originalInvoiceId: original.id,
      businessPartnerId: buyer.id,
      lines: [{ itemId: ctx.item.id, description: "Returned fan", quantity: "1", unitPrice: "500" }],
    });
    const submission = await submissionFor(credit.id);
    expect(submission?.status).toBe("VALID");
    expect((submission?.requestJson as any).invoiceType).toBe("Debit Note");
    expect((submission?.requestJson as any).invoiceRefNo).toBe(originalFbr);
  });

  it("leaves Saudi companies untouched: no FBR submission, PK categories refused", async () => {
    const sa = await setupUserWithCompany(app);
    const customer = (
      await request(server)
        .post("/partners")
        .set(auth(sa.accessToken))
        .send({ code: uniqueCode("C"), name: "Riyadh Co", partnerType: "CUSTOMER", taxRegistrationNumber: "300000000000003" })
        .expect(201)
    ).body;
    const today = new Date().toISOString();
    const base = { businessPartnerId: customer.id, issueDateTime: today, postingDate: today, dueDate: today };
    await request(server)
      .post("/ar/invoices")
      .set(auth(sa.accessToken))
      .send({ ...base, lines: [{ description: "x", quantity: "1", unitPrice: "100", vatCategory: "PK_STANDARD", accountId: sa.accountByCode("4100").id }] })
      .expect(400);
    const draft = await request(server)
      .post("/ar/invoices")
      .set(auth(sa.accessToken))
      .send({ ...base, lines: [{ description: "x", quantity: "1", unitPrice: "100", accountId: sa.accountByCode("4100").id }] })
      .expect(201);
    expect(Number(draft.body.vatTotal)).toBe(15);
    const posted = await request(server).post(`/ar/invoices/${draft.body.id}/post`).set(auth(sa.accessToken)).expect(201);
    expect(await submissionFor(posted.body.id)).toBeNull();
    // FBR settings can't be switched on for a non-PK company
    await getPrisma(app).company.update({ where: { id: sa.companyId }, data: { enabledModules: ["fbr"] } });
    const relogin = await request(server).post("/auth/login").send({ email: sa.email, password: sa.password }).expect(201);
    await request(server).put("/fbr/settings").set(auth(relogin.body.accessToken)).send({ enabled: true }).expect(409);
  });

  // ── POS Integration ────────────────────────────────────────────────

  async function setupPos() {
    const ctx = await setupPakistanCompany();
    const walkIn = await ctx.customer({ name: "Walk-in Customer", province: undefined });
    const terminalRes = await request(server)
      .post("/pos/terminals")
      .set(auth(ctx.token))
      .send({ code: "TILL1", name: "Front till", fbrPosId: 812345, walkInPartnerId: walkIn.id, cashAccountId: ctx.acct("1110").id, cardAccountId: ctx.acct("1120").id })
      .expect(201);
    const key: string = terminalRes.body.apiKey;
    expect(key).toMatch(/^pos_/);
    const sale = (body: Record<string, unknown>, apiKey = key) => request(server).post("/pos/v1/sales").set("X-POS-Key", apiKey).send(body);
    return { ...ctx, walkIn, terminal: terminalRes.body, key, sale };
  }

  it("accepts a POS sale by API key, posts + settles it, books the POS fee, and returns the FBR number", async () => {
    const ctx = await setupPos();
    const res = await ctx
      .sale({
        clientSaleId: "S-1001",
        paymentMode: 1,
        buyer: { name: "Ali Raza", ntnCnic: "3520212345671", phone: "03001234567" },
        lines: [{ itemCode: ctx.item.code, quantity: "2", unitPrice: "118" }],
      })
      .expect(200);

    expect(res.body.type).toBe("SALE");
    expect(res.body.totals).toEqual({ saleValue: "200", salesTax: "36", furtherTax: "0", total: "236", posFee: "1", amountPayable: "237" });
    expect(res.body.fbr.status).toBe("VALID");
    expect(res.body.fbr.invoiceNumber).toMatch(/^812345\d{12}\d{3}$/);
    expect(res.body.fbr.qrPayload).toBe(res.body.fbr.invoiceNumber);

    const prisma = getPrisma(app);
    const invoice = await prisma.salesInvoice.findFirstOrThrow({ where: { companyId: ctx.companyId, invoiceNumber: res.body.erpInvoiceNumber } });
    expect(invoice.status).toBe("PAID");
    const submission = await submissionFor(invoice.id);
    expect(submission?.channel).toBe("POS");
    const payload = submission?.requestJson as any;
    expect(payload).toMatchObject({ POSID: 812345, USIN: res.body.erpInvoiceNumber, BuyerCNIC: "3520212345671", BuyerName: "Ali Raza", PaymentMode: 1, InvoiceType: 1, TotalSaleValue: 200, TotalTaxCharged: 36, TotalBillAmount: 236 });
    expect(payload.Items[0].PCTCode).toBe("84145100");

    // Fee JE: Dr cash 1 / Cr 2300 1
    const posSale = await prisma.posSale.findFirstOrThrow({ where: { companyId: ctx.companyId, clientSaleId: "S-1001" } });
    const feeJe = await prisma.journalEntry.findFirstOrThrow({ where: { sourceDocumentId: posSale.id }, include: { lines: { include: { account: true } } } });
    expect(Number(feeJe.lines.find((l) => l.account.code === "2300")!.credit)).toBe(1);
    expect(Number(feeJe.lines.find((l) => l.account.code === "1110")!.debit)).toBe(1);
  });

  it("is idempotent per clientSaleId (a resend returns the same sale)", async () => {
    const ctx = await setupPos();
    const body = { clientSaleId: "S-2001", paymentMode: 2, lines: [{ itemCode: ctx.item.code, quantity: "1", unitPrice: "118" }] };
    const first = await ctx.sale(body).expect(200);
    const second = await ctx.sale(body).expect(200);
    expect(second.body.erpInvoiceNumber).toBe(first.body.erpInvoiceNumber);
    expect(second.body.fbr.invoiceNumber).toBe(first.body.fbr.invoiceNumber);
    const prisma = getPrisma(app);
    expect(await prisma.posSale.count({ where: { companyId: ctx.companyId } })).toBe(1);
    expect(await prisma.payment.count({ where: { companyId: ctx.companyId } })).toBe(1);
    const invoices = await prisma.salesInvoice.count({ where: { companyId: ctx.companyId } });
    expect(invoices).toBe(1);
  });

  it("processes a return as an FBR credit invoice refunded from the till", async () => {
    const ctx = await setupPos();
    const sale = await ctx.sale({ clientSaleId: "S-3001", paymentMode: 1, lines: [{ itemCode: ctx.item.code, quantity: "3", unitPrice: "118" }] }).expect(200);
    const ret = await request(server)
      .post("/pos/v1/sales/S-3001/returns")
      .set("X-POS-Key", ctx.key)
      .send({ clientSaleId: "R-3001", lines: [{ itemCode: ctx.item.code, quantity: "1" }] })
      .expect(200);
    expect(ret.body.type).toBe("RETURN");
    expect(ret.body.totals.total).toBe("118");
    expect(ret.body.totals.posFee).toBe("0");
    expect(ret.body.fbr.status).toBe("VALID");

    const prisma = getPrisma(app);
    const credit = await prisma.salesInvoice.findFirstOrThrow({ where: { companyId: ctx.companyId, invoiceNumber: ret.body.erpInvoiceNumber }, include: { journalEntry: { include: { lines: { include: { account: true } } } } } });
    const payload = (await submissionFor(credit.id))?.requestJson as any;
    expect(payload.InvoiceType).toBe(3);
    expect(payload.RefUSIN).toBe(sale.body.erpInvoiceNumber);
    // Refund credits cash, not AR
    expect(Number(credit.journalEntry!.lines.find((l) => l.account.code === "1110")!.credit)).toBe(118);
    expect(credit.journalEntry!.lines.find((l) => l.account.controlAccountType === "AR")).toBeUndefined();

    // Can't return more than was sold
    await request(server)
      .post("/pos/v1/sales/S-3001/returns")
      .set("X-POS-Key", ctx.key)
      .send({ clientSaleId: "R-3002", lines: [{ itemCode: ctx.item.code, quantity: "4" }] })
      .expect(400);
  });

  it("answers PENDING during an FBR outage and the fiscal number appears after the retry", async () => {
    const ctx = await setupPos();
    app.get(FbrApiClient).simulateOutage(1);
    const res = await ctx.sale({ clientSaleId: "S-4001", paymentMode: 1, lines: [{ itemCode: ctx.item.code, quantity: "1", unitPrice: "118" }] }).expect(200);
    expect(res.body.fbr.status).toBe("PENDING");
    expect(res.body.fbr.invoiceNumber).toBeNull();

    await app.get(FbrSubmissionService).retryDue(new Date(Date.now() + 2 * 60_000));
    const poll = await request(server).get("/pos/v1/sales/S-4001").set("X-POS-Key", ctx.key).expect(200);
    expect(poll.body.fbr.status).toBe("VALID");
    expect(poll.body.fbr.invoiceNumber).toBeTruthy();
  });

  it("clinic counter: ICT-services treatment + 18% product sold by a logged-in cashier", async () => {
    const ctx = await setupPos();
    await request(server).put("/fbr/settings").set(auth(ctx.token)).send({ servicesTaxRatePercent: "15" }).expect(200);
    const treatment = (
      await request(server)
        .post("/items")
        .set(auth(ctx.token))
        .send({
          code: uniqueCode("LASER"),
          name: "Laser hair removal (session)",
          itemType: "SERVICE",
          baseUoMId: ctx.uom.id,
          vatCategory: "PK_SERVICES",
          hsCode: "9819.9000",
          defaultSalesPrice: "11500",
          defaultSalesAccountId: ctx.acct("4100").id,
        })
        .expect(201)
    ).body;

    const items = await request(server).get(`/pos/counter/${ctx.terminal.id}/items`).set(auth(ctx.token)).expect(200);
    expect(items.body.find((i: any) => i.code === treatment.code).defaultSalesPrice).toBe("11500");

    const sale = await request(server)
      .post(`/pos/counter/${ctx.terminal.id}/sales`)
      .set(auth(ctx.token))
      .send({
        clientSaleId: "C-9001",
        paymentMode: 2,
        buyer: { name: "Sara Khan" },
        lines: [
          { itemCode: treatment.code, quantity: "1", unitPrice: "11500" }, // 10,000 + 15% ICT services tax
          { itemCode: ctx.item.code, quantity: "1", unitPrice: "1180" }, // 1,000 + 18% goods
        ],
      })
      .expect(200);

    expect(sale.body.totals).toMatchObject({ saleValue: "11000", salesTax: "1680", total: "12680", amountPayable: "12681" });
    expect(sale.body.lines.map((l: any) => l.taxRate)).toEqual(["15", "18"]);
    expect(sale.body.lines[0].itemCode).toBe(treatment.code);
    expect(sale.body.fbr.status).toBe("VALID");

    const invoice = await getPrisma(app).salesInvoice.findFirstOrThrow({ where: { companyId: ctx.companyId, invoiceNumber: sale.body.erpInvoiceNumber } });
    const payload = (await submissionFor(invoice.id))?.requestJson as any;
    expect(payload.Items[0]).toMatchObject({ PCTCode: "98199000", TaxRate: 15, SaleValue: 10000, TaxCharged: 1500 });
    expect(payload.PaymentMode).toBe(2);

    const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
    const list = await request(server).get(`/pos/counter/${ctx.terminal.id}/sales?date=${today}`).set(auth(ctx.token)).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].buyer.name).toBe("Sara Khan");
  });

  it("rejects bad keys, rotated keys and unknown items (leaving nothing behind)", async () => {
    const ctx = await setupPos();
    const body = { clientSaleId: "S-5001", paymentMode: 1, lines: [{ itemCode: ctx.item.code, quantity: "1", unitPrice: "118" }] };
    await ctx.sale(body, "pos_not-a-real-key-at-all-000000").expect(401);
    await request(server).post("/pos/v1/sales").send(body).expect(401);

    const rotated = await request(server).post(`/pos/terminals/${ctx.terminal.id}/rotate-key`).set(auth(ctx.token)).expect(201);
    await ctx.sale(body).expect(401); // old key dead
    await ctx.sale(body, rotated.body.apiKey).expect(200);

    await ctx.sale({ ...body, clientSaleId: "S-5002", lines: [{ itemCode: "NOPE", quantity: "1", unitPrice: "1" }] }, rotated.body.apiKey).expect(400);
    const list = await request(server).get("/pos/terminals").set(auth(ctx.token)).expect(200);
    expect(list.body[0].apiKey).toBeUndefined();
    expect(await getPrisma(app).salesInvoice.count({ where: { companyId: ctx.companyId, status: "DRAFT" } })).toBe(0);

    const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
    const summary = await request(server).get(`/pos/terminals/daily-summary?date=${today}`).set(auth(ctx.token)).expect(200);
    expect(summary.body[0]).toMatchObject({ transactions: 1, netSales: "118", posFees: "1", fbrAcknowledged: 1, fbrOutstanding: 0 });
  });
});
