import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, createItem, createPartner, setupUserWithCompany } from "./utils/test-app";

describe("Finance AP (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupApContext() {
    const ctx = await setupUserWithCompany(app);
    const vendor = await createPartner(app, ctx.accessToken, "VENDOR");
    const expenseAccount = ctx.accountByCode("5240");
    const item = await createItem(app, ctx.accessToken, { defaultPurchaseAccountId: expenseAccount.id });
    return { ...ctx, vendor, item, expenseAccount };
  }

  function invoicePayload(ctx: Awaited<ReturnType<typeof setupApContext>>, overrides: Record<string, unknown> = {}) {
    const today = new Date().toISOString();
    return {
      businessPartnerId: ctx.vendor.id,
      vendorInvoiceNumber: `VND-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      postingDate: today,
      dueDate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      lines: [{ itemId: ctx.item.id, description: "Office supplies", quantity: "4", unitPrice: "250" }],
      ...overrides,
    };
  }

  it("posts an AP invoice with correct input-VAT JE composition", async () => {
    const ctx = await setupApContext();

    const draft = await request(app.getHttpServer())
      .post("/ap/invoices")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send(invoicePayload(ctx))
      .expect(201);

    // 4×250 = 1000 net, 150 VAT, 1150 gross
    expect(Number(draft.body.netTotal)).toBe(1000);
    expect(Number(draft.body.vatTotal)).toBe(150);

    const posted = await request(app.getHttpServer())
      .post(`/ap/invoices/${draft.body.id}/post`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(201);

    expect(posted.body.status).toBe("POSTED");
    expect(posted.body.invoiceNumber).toBe("PINV-000001");
    expect(Number(posted.body.openAmount)).toBe(1150);

    // JE: Dr 5240 expense 1000, Dr 1150 input VAT 150 / Cr 2110 AP 1150 (partner-tagged)
    const je = await request(app.getHttpServer())
      .get(`/gl/journal-entries/${posted.body.journalEntryId}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(200);
    expect(je.body.sourceModule).toBe("AP");

    const lineByCode = (code: string) => je.body.lines.filter((l: any) => l.account.code === code);
    expect(Number(lineByCode("5240")[0].debit)).toBe(1000);
    expect(Number(lineByCode("1150")[0].debit)).toBe(150);
    expect(Number(lineByCode("2110")[0].credit)).toBe(1150);
    expect(lineByCode("2110")[0].businessPartnerId).toBe(ctx.vendor.id);
  });

  it("rejects booking the same vendor invoice number twice", async () => {
    const ctx = await setupApContext();
    const payload = invoicePayload(ctx);

    await request(app.getHttpServer())
      .post("/ap/invoices")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send(payload)
      .expect(201);

    await request(app.getHttpServer())
      .post("/ap/invoices")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send(payload)
      .expect(409);
  });

  it("cancels an unpaid posted AP invoice via reversal", async () => {
    const ctx = await setupApContext();

    const draft = await request(app.getHttpServer())
      .post("/ap/invoices")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send(invoicePayload(ctx))
      .expect(201);
    const posted = await request(app.getHttpServer())
      .post(`/ap/invoices/${draft.body.id}/post`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(201);

    const cancelled = await request(app.getHttpServer())
      .post(`/ap/invoices/${draft.body.id}/cancel`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(201);
    expect(cancelled.body.status).toBe("CANCELLED");

    const je = await request(app.getHttpServer())
      .get(`/gl/journal-entries/${posted.body.journalEntryId}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(200);
    expect(je.body.status).toBe("REVERSED");
  });

  it("rejects a customer-only partner on an AP invoice", async () => {
    const ctx = await setupApContext();
    const customer = await createPartner(app, ctx.accessToken, "CUSTOMER");

    await request(app.getHttpServer())
      .post("/ap/invoices")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send(invoicePayload(ctx, { businessPartnerId: customer.id }))
      .expect(400);
  });
});
