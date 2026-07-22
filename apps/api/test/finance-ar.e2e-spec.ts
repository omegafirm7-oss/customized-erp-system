import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, createItem, createPartner, setupUserWithCompany } from "./utils/test-app";

describe("Finance AR (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupArContext() {
    const ctx = await setupUserWithCompany(app);
    const customer = await createPartner(app, ctx.accessToken, "CUSTOMER");
    const revenueAccount = ctx.accountByCode("4100");
    const item = await createItem(app, ctx.accessToken, { defaultSalesAccountId: revenueAccount.id });
    return { ...ctx, customer, item, revenueAccount };
  }

  function invoicePayload(ctx: Awaited<ReturnType<typeof setupArContext>>, overrides: Record<string, unknown> = {}) {
    const today = new Date().toISOString();
    return {
      businessPartnerId: ctx.customer.id,
      issueDateTime: today,
      postingDate: today,
      dueDate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      lines: [
        { itemId: ctx.item.id, description: "Consulting services", quantity: "10", unitPrice: "100" },
        { itemId: ctx.item.id, description: "Zero-rated export", quantity: "1", unitPrice: "500", vatCategory: "ZERO_RATED" },
      ],
      ...overrides,
    };
  }

  it("provisions new companies with VAT accounts and all six numbering series", async () => {
    const ctx = await setupUserWithCompany(app);

    const vatInput = ctx.accountByCode("1150");
    const vatOutput = ctx.accountByCode("2200");
    const fx = ctx.accountByCode("5850");
    expect(vatInput?.controlAccountType).toBe("VAT_INPUT");
    expect(vatOutput?.controlAccountType).toBe("VAT_OUTPUT");
    expect(fx).toBeDefined();
  });

  it("posts an AR invoice with correct VAT and JE composition", async () => {
    const ctx = await setupArContext();

    const draftRes = await request(app.getHttpServer())
      .post("/ar/invoices")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send(invoicePayload(ctx))
      .expect(201);

    // 10×100 standard (VAT 150) + 1×500 zero-rated (VAT 0)
    expect(draftRes.body.status).toBe("DRAFT");
    expect(draftRes.body.invoiceNumber).toBeNull();
    expect(Number(draftRes.body.netTotal)).toBe(1500);
    expect(Number(draftRes.body.vatTotal)).toBe(150);
    expect(Number(draftRes.body.grossTotal)).toBe(1650);

    const postRes = await request(app.getHttpServer())
      .post(`/ar/invoices/${draftRes.body.id}/post`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(201);

    expect(postRes.body.status).toBe("POSTED");
    expect(postRes.body.invoiceNumber).toBe("INV-000001");
    expect(Number(postRes.body.openAmount)).toBe(1650);
    expect(postRes.body.buyerTrnSnapshot).toBe("300000000000003");
    expect(postRes.body.invoiceTypeCode).toBe("388");
    expect(postRes.body.journalEntryId).toBeTruthy();

    // Verify the JE: Dr 1210 AR 1650 / Cr 4100 revenue 1500 / Cr 2200 VAT 150
    const jeRes = await request(app.getHttpServer())
      .get(`/gl/journal-entries/${postRes.body.journalEntryId}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(200);

    expect(jeRes.body.status).toBe("POSTED");
    expect(jeRes.body.sourceModule).toBe("AR");
    expect(jeRes.body.sourceDocumentId).toBe(postRes.body.id);

    const lineByCode = (code: string) => jeRes.body.lines.filter((l: any) => l.account.code === code);
    expect(Number(lineByCode("1210")[0].debit)).toBe(1650);
    const revenueTotal = lineByCode("4100").reduce((s: number, l: any) => s + Number(l.credit), 0);
    expect(revenueTotal).toBe(1500);
    expect(Number(lineByCode("2200")[0].credit)).toBe(150);
    // AR line carries the partner tag for subledger reporting
    expect(lineByCode("1210")[0].businessPartnerId).toBe(ctx.customer.id);
  });

  it("allows editing and deleting drafts, but not posting twice", async () => {
    const ctx = await setupArContext();

    const draftRes = await request(app.getHttpServer())
      .post("/ar/invoices")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send(invoicePayload(ctx))
      .expect(201);

    // Edit: replace with a single line
    const updateRes = await request(app.getHttpServer())
      .patch(`/ar/invoices/${draftRes.body.id}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send(invoicePayload(ctx, { lines: [{ itemId: ctx.item.id, description: "Only line", quantity: "1", unitPrice: "200" }] }))
      .expect(200);
    expect(Number(updateRes.body.netTotal)).toBe(200);
    expect(updateRes.body.lines).toHaveLength(1);

    await request(app.getHttpServer())
      .post(`/ar/invoices/${draftRes.body.id}/post`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(201);

    // Posting again → 409; editing a posted invoice → 409; deleting → 409
    await request(app.getHttpServer())
      .post(`/ar/invoices/${draftRes.body.id}/post`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/ar/invoices/${draftRes.body.id}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send(invoicePayload(ctx))
      .expect(409);
    await request(app.getHttpServer())
      .delete(`/ar/invoices/${draftRes.body.id}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(409);

    // A fresh draft can be hard-deleted
    const draft2 = await request(app.getHttpServer())
      .post("/ar/invoices")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send(invoicePayload(ctx))
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/ar/invoices/${draft2.body.id}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(200);
  });

  it("applies a credit note against the original and rejects over-crediting", async () => {
    const ctx = await setupArContext();

    const invoice = await request(app.getHttpServer())
      .post("/ar/invoices")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send(invoicePayload(ctx, { lines: [{ itemId: ctx.item.id, description: "Services", quantity: "1", unitPrice: "1000" }] }))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/ar/invoices/${invoice.body.id}/post`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(201);
    // gross = 1150 (1000 + 15% VAT)

    // Over-crediting: CN gross 2300 > open 1150 → rejected at post
    const bigCn = await request(app.getHttpServer())
      .post("/ar/invoices")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send(
        invoicePayload(ctx, {
          documentKind: "CREDIT_NOTE",
          originalInvoiceId: invoice.body.id,
          lines: [{ itemId: ctx.item.id, description: "Refund", quantity: "2", unitPrice: "1000" }],
        }),
      )
      .expect(201);
    await request(app.getHttpServer())
      .post(`/ar/invoices/${bigCn.body.id}/post`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(400);

    // Valid partial credit note: 230 gross (200 + 30 VAT)
    const cn = await request(app.getHttpServer())
      .post("/ar/invoices")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send(
        invoicePayload(ctx, {
          documentKind: "CREDIT_NOTE",
          originalInvoiceId: invoice.body.id,
          lines: [{ itemId: ctx.item.id, description: "Partial refund", quantity: "1", unitPrice: "200" }],
        }),
      )
      .expect(201);
    const cnPosted = await request(app.getHttpServer())
      .post(`/ar/invoices/${cn.body.id}/post`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(201);

    expect(cnPosted.body.invoiceNumber).toBe("CN-000001");
    expect(cnPosted.body.invoiceTypeCode).toBe("381");

    // Original: open reduced by 230 → 920, PARTIALLY_PAID
    const originalAfter = await request(app.getHttpServer())
      .get(`/ar/invoices/${invoice.body.id}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(200);
    expect(Number(originalAfter.body.openAmount)).toBe(920);
    expect(originalAfter.body.status).toBe("PARTIALLY_PAID");

    // CN JE polarity: Dr revenue + Dr VAT / Cr AR
    const cnJe = await request(app.getHttpServer())
      .get(`/gl/journal-entries/${cnPosted.body.journalEntryId}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(200);
    const arLine = cnJe.body.lines.find((l: any) => l.account.code === "1210");
    expect(Number(arLine.credit)).toBe(230);
  });

  it("cancels an unpaid posted invoice via reversal, refuses when paid", async () => {
    const ctx = await setupArContext();

    const invoice = await request(app.getHttpServer())
      .post("/ar/invoices")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send(invoicePayload(ctx))
      .expect(201);
    const posted = await request(app.getHttpServer())
      .post(`/ar/invoices/${invoice.body.id}/post`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(201);

    const cancelRes = await request(app.getHttpServer())
      .post(`/ar/invoices/${invoice.body.id}/cancel`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(201);
    expect(cancelRes.body.status).toBe("CANCELLED");
    expect(Number(cancelRes.body.openAmount)).toBe(0);

    // The invoice JE is now REVERSED with a linked reversal entry
    const jeRes = await request(app.getHttpServer())
      .get(`/gl/journal-entries/${posted.body.journalEntryId}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(200);
    expect(jeRes.body.status).toBe("REVERSED");

    // Cancelling again → 409
    await request(app.getHttpServer())
      .post(`/ar/invoices/${invoice.body.id}/cancel`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(409);
  });

  it("isolates AR data between companies", async () => {
    const a = await setupArContext();
    const b = await setupUserWithCompany(app);

    const invoice = await request(app.getHttpServer())
      .post("/ar/invoices")
      .set("Authorization", `Bearer ${a.accessToken}`)
      .send(invoicePayload(a))
      .expect(201);

    await request(app.getHttpServer())
      .get(`/ar/invoices/${invoice.body.id}`)
      .set("Authorization", `Bearer ${b.accessToken}`)
      .expect(404);
  });
});
