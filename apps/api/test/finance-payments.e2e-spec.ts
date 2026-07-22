import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, createItem, createPartner, setupUserWithCompany } from "./utils/test-app";

describe("Finance payments (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupWithPostedInvoice(unitPrice = "1000") {
    const ctx = await setupUserWithCompany(app);
    const customer = await createPartner(app, ctx.accessToken, "CUSTOMER");
    const revenueAccount = ctx.accountByCode("4100");
    const item = await createItem(app, ctx.accessToken, { defaultSalesAccountId: revenueAccount.id });

    const today = new Date().toISOString();
    const draft = await request(app.getHttpServer())
      .post("/ar/invoices")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        businessPartnerId: customer.id,
        issueDateTime: today,
        postingDate: today,
        dueDate: today,
        lines: [{ itemId: item.id, description: "Services", quantity: "1", unitPrice }],
      })
      .expect(201);
    const invoice = (
      await request(app.getHttpServer())
        .post(`/ar/invoices/${draft.body.id}/post`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(201)
    ).body;

    return { ...ctx, customer, item, invoice, bankAccount: ctx.accountByCode("1120") };
  }

  it("fully allocates an incoming payment → invoice PAID, correct JE", async () => {
    const ctx = await setupWithPostedInvoice("1000"); // gross 1150

    const payment = await request(app.getHttpServer())
      .post("/payments/incoming")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        businessPartnerId: ctx.customer.id,
        paymentDate: new Date().toISOString(),
        bankCashAccountId: ctx.bankAccount.id,
        amount: "1150",
        allocations: [{ invoiceId: ctx.invoice.id, amount: "1150" }],
      })
      .expect(201);

    expect(payment.body.paymentNumber).toBe("RCT-000001");
    expect(Number(payment.body.allocatedAmount)).toBe(1150);
    expect(Number(payment.body.unallocatedAmount)).toBe(0);

    const invoiceAfter = await request(app.getHttpServer())
      .get(`/ar/invoices/${ctx.invoice.id}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(200);
    expect(invoiceAfter.body.status).toBe("PAID");
    expect(Number(invoiceAfter.body.openAmount)).toBe(0);

    // JE: Dr 1120 bank 1150 / Cr 1210 AR 1150
    const je = await request(app.getHttpServer())
      .get(`/gl/journal-entries/${payment.body.journalEntryId}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(200);
    const bankLine = je.body.lines.find((l: any) => l.account.code === "1120");
    const arLine = je.body.lines.find((l: any) => l.account.code === "1210");
    expect(Number(bankLine.debit)).toBe(1150);
    expect(Number(arLine.credit)).toBe(1150);
    expect(arLine.businessPartnerId).toBe(ctx.customer.id);
  });

  it("partial payments walk the invoice PARTIALLY_PAID → PAID", async () => {
    const ctx = await setupWithPostedInvoice("1000"); // gross 1150

    await request(app.getHttpServer())
      .post("/payments/incoming")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        businessPartnerId: ctx.customer.id,
        paymentDate: new Date().toISOString(),
        bankCashAccountId: ctx.bankAccount.id,
        amount: "500",
        allocations: [{ invoiceId: ctx.invoice.id, amount: "500" }],
      })
      .expect(201);

    let invoiceAfter = (
      await request(app.getHttpServer())
        .get(`/ar/invoices/${ctx.invoice.id}`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
    ).body;
    expect(invoiceAfter.status).toBe("PARTIALLY_PAID");
    expect(Number(invoiceAfter.openAmount)).toBe(650);

    await request(app.getHttpServer())
      .post("/payments/incoming")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        businessPartnerId: ctx.customer.id,
        paymentDate: new Date().toISOString(),
        bankCashAccountId: ctx.bankAccount.id,
        amount: "650",
        allocations: [{ invoiceId: ctx.invoice.id, amount: "650" }],
      })
      .expect(201);

    invoiceAfter = (
      await request(app.getHttpServer())
        .get(`/ar/invoices/${ctx.invoice.id}`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
    ).body;
    expect(invoiceAfter.status).toBe("PAID");
  });

  it("rejects over-allocation against the invoice and the payment amount", async () => {
    const ctx = await setupWithPostedInvoice("1000"); // gross 1150

    // Allocation exceeds invoice open amount
    await request(app.getHttpServer())
      .post("/payments/incoming")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        businessPartnerId: ctx.customer.id,
        paymentDate: new Date().toISOString(),
        bankCashAccountId: ctx.bankAccount.id,
        amount: "2000",
        allocations: [{ invoiceId: ctx.invoice.id, amount: "1200" }],
      })
      .expect(400);

    // Allocations exceed the payment amount
    await request(app.getHttpServer())
      .post("/payments/incoming")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        businessPartnerId: ctx.customer.id,
        paymentDate: new Date().toISOString(),
        bankCashAccountId: ctx.bankAccount.id,
        amount: "100",
        allocations: [{ invoiceId: ctx.invoice.id, amount: "500" }],
      })
      .expect(400);
  });

  it("keeps an unallocated remainder on account", async () => {
    const ctx = await setupWithPostedInvoice("1000"); // gross 1150

    const payment = await request(app.getHttpServer())
      .post("/payments/incoming")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        businessPartnerId: ctx.customer.id,
        paymentDate: new Date().toISOString(),
        bankCashAccountId: ctx.bankAccount.id,
        amount: "2000",
        allocations: [{ invoiceId: ctx.invoice.id, amount: "1150" }],
      })
      .expect(201);

    expect(Number(payment.body.allocatedAmount)).toBe(1150);
    expect(Number(payment.body.unallocatedAmount)).toBe(850);
  });

  it("cancelling a payment restores invoice status and amounts", async () => {
    const ctx = await setupWithPostedInvoice("1000"); // gross 1150

    const payment = await request(app.getHttpServer())
      .post("/payments/incoming")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        businessPartnerId: ctx.customer.id,
        paymentDate: new Date().toISOString(),
        bankCashAccountId: ctx.bankAccount.id,
        amount: "1150",
        allocations: [{ invoiceId: ctx.invoice.id, amount: "1150" }],
      })
      .expect(201);

    const cancelRes = await request(app.getHttpServer())
      .post(`/payments/${payment.body.id}/cancel`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(201);
    expect(cancelRes.body.status).toBe("CANCELLED");

    const invoiceAfter = (
      await request(app.getHttpServer())
        .get(`/ar/invoices/${ctx.invoice.id}`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
    ).body;
    expect(invoiceAfter.status).toBe("POSTED");
    expect(Number(invoiceAfter.openAmount)).toBe(1150);
    expect(Number(invoiceAfter.paidAmount)).toBe(0);

    // Payment JE was reversed
    const je = await request(app.getHttpServer())
      .get(`/gl/journal-entries/${payment.body.journalEntryId}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(200);
    expect(je.body.status).toBe("REVERSED");

    // Invoice can now be cancelled (no more payments applied)
    await request(app.getHttpServer())
      .post(`/ar/invoices/${ctx.invoice.id}/cancel`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(201);
  });

  it("pays a vendor invoice with an outgoing payment", async () => {
    const ctx = await setupUserWithCompany(app);
    const vendor = await createPartner(app, ctx.accessToken, "VENDOR");
    const expenseAccount = ctx.accountByCode("5240");
    const item = await createItem(app, ctx.accessToken, { defaultPurchaseAccountId: expenseAccount.id });

    const today = new Date().toISOString();
    const draft = await request(app.getHttpServer())
      .post("/ap/invoices")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        businessPartnerId: vendor.id,
        vendorInvoiceNumber: `VND-${Date.now()}`,
        postingDate: today,
        dueDate: today,
        lines: [{ itemId: item.id, description: "Supplies", quantity: "1", unitPrice: "400" }],
      })
      .expect(201);
    const invoice = (
      await request(app.getHttpServer())
        .post(`/ap/invoices/${draft.body.id}/post`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(201)
    ).body; // gross 460

    const payment = await request(app.getHttpServer())
      .post("/payments/outgoing")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        businessPartnerId: vendor.id,
        paymentDate: new Date().toISOString(),
        bankCashAccountId: ctx.accountByCode("1120").id,
        amount: "460",
        allocations: [{ invoiceId: invoice.id, amount: "460" }],
      })
      .expect(201);

    expect(payment.body.paymentNumber).toBe("PAY-000001");

    const invoiceAfter = (
      await request(app.getHttpServer())
        .get(`/ap/invoices/${invoice.id}`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
    ).body;
    expect(invoiceAfter.status).toBe("PAID");

    // JE: Dr 2110 AP 460 / Cr 1120 bank 460
    const je = await request(app.getHttpServer())
      .get(`/gl/journal-entries/${payment.body.journalEntryId}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(200);
    const apLine = je.body.lines.find((l: any) => l.account.code === "2110");
    const bankLine = je.body.lines.find((l: any) => l.account.code === "1120");
    expect(Number(apLine.debit)).toBe(460);
    expect(Number(bankLine.credit)).toBe(460);
  });
});
