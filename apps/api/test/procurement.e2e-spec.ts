import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, createItem, createPartner, grantModules, setupUserWithCompany } from "./utils/test-app";

describe("Procurement cycle — Quotation → Order → Invoice (e2e)", () => {
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
    // module-entitlement.e2e-spec.ts) — this suite exercises the Purchase
    // module's actual behavior, so grant it explicitly, as a platform admin
    // would via the Platform Dashboard.
    const accessToken = await grantModules(app, ctx, ["purchase"]);
    const vendor = await createPartner(app, accessToken, "VENDOR");
    const expenseAccount = ctx.accountByCode("5240");
    const item = await createItem(app, accessToken, { defaultPurchaseAccountId: expenseAccount.id });
    return { ...ctx, accessToken, vendor, item };
  }

  it("creates a quotation, converts it to a purchase order, and generates a purchase invoice from it", async () => {
    const ctx = await setupContext();

    const quotation = (
      await request(app.getHttpServer())
        .post("/ap/quotations")
        .set(auth(ctx.accessToken))
        .send({
          businessPartnerId: ctx.vendor.id,
          quotationDate: new Date().toISOString(),
          lines: [{ itemId: ctx.item.id, description: "Steel rebar", quantity: "10", unitPrice: "100" }],
        })
        .expect(201)
    ).body;
    expect(quotation.quotationNumber).toMatch(/^PQ-/);
    expect(quotation.status).toBe("RECEIVED");

    const order = (
      await request(app.getHttpServer())
        .post(`/ap/orders/from-quotation/${quotation.id}`)
        .set(auth(ctx.accessToken))
        .expect(201)
    ).body;
    expect(order.orderNumber).toMatch(/^PO-/);
    expect(order.status).toBe("SENT");
    expect(order.sourceQuotationId).toBe(quotation.id);
    expect(order.lines).toHaveLength(1);
    expect(Number(order.lines[0].quantity)).toBe(10);
    expect(Number(order.lines[0].invoicedQuantity)).toBe(0);

    const quotationAfter = (
      await request(app.getHttpServer()).get(`/ap/quotations/${quotation.id}`).set(auth(ctx.accessToken)).expect(200)
    ).body;
    expect(quotationAfter.status).toBe("CONVERTED");

    // Converting again is rejected
    await request(app.getHttpServer())
      .post(`/ap/orders/from-quotation/${quotation.id}`)
      .set(auth(ctx.accessToken))
      .expect(409);

    const invoice = (
      await request(app.getHttpServer())
        .post(`/ap/orders/${order.id}/generate-invoice`)
        .set(auth(ctx.accessToken))
        .send({
          vendorInvoiceNumber: `VND-${Date.now()}`,
          postingDate: new Date().toISOString(),
          dueDate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        })
        .expect(201)
    ).body;
    expect(invoice.status).toBe("DRAFT");
    expect(Number(invoice.netTotal)).toBe(1000); // 10 x 100
    // sourcePurchaseOrderId isn't returned by createDraft's include, but can be fetched directly
    const invoiceFull = (
      await request(app.getHttpServer()).get(`/ap/invoices/${invoice.id}`).set(auth(ctx.accessToken)).expect(200)
    ).body;
    expect(invoiceFull.sourcePurchaseOrderId).toBe(order.id);

    const orderAfter = (
      await request(app.getHttpServer()).get(`/ap/orders/${order.id}`).set(auth(ctx.accessToken)).expect(200)
    ).body;
    expect(orderAfter.status).toBe("INVOICED");
    expect(Number(orderAfter.lines[0].invoicedQuantity)).toBe(10);

    // Fully invoiced — generating again is rejected
    await request(app.getHttpServer())
      .post(`/ap/orders/${order.id}/generate-invoice`)
      .set(auth(ctx.accessToken))
      .send({
        vendorInvoiceNumber: `VND2-${Date.now()}`,
        postingDate: new Date().toISOString(),
        dueDate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      })
      .expect(409);

    // Fully invoiced order cannot be cancelled
    await request(app.getHttpServer()).post(`/ap/orders/${order.id}/cancel`).set(auth(ctx.accessToken)).expect(409);
  });

  it("creates a purchase order directly, without a quotation", async () => {
    const ctx = await setupContext();

    const order = (
      await request(app.getHttpServer())
        .post("/ap/orders")
        .set(auth(ctx.accessToken))
        .send({
          businessPartnerId: ctx.vendor.id,
          orderDate: new Date().toISOString(),
          lines: [{ description: "Cement bags", quantity: "50", unitPrice: "20" }],
        })
        .expect(201)
    ).body;
    expect(order.sourceQuotationId).toBeNull();
    expect(order.status).toBe("SENT");

    // A DRAFT-free direct PO can be cancelled cleanly before any invoicing
    const cancelled = (
      await request(app.getHttpServer()).post(`/ap/orders/${order.id}/cancel`).set(auth(ctx.accessToken)).expect(201)
    ).body;
    expect(cancelled.status).toBe("CANCELLED");

    // Cancelling again is rejected
    await request(app.getHttpServer()).post(`/ap/orders/${order.id}/cancel`).set(auth(ctx.accessToken)).expect(409);
  });

  it("rejects a quotation for a customer-only partner and blocks cancelling an already-converted quotation", async () => {
    const ctx = await setupContext();
    const customerOnly = await createPartner(app, ctx.accessToken, "CUSTOMER");

    await request(app.getHttpServer())
      .post("/ap/quotations")
      .set(auth(ctx.accessToken))
      .send({
        businessPartnerId: customerOnly.id,
        quotationDate: new Date().toISOString(),
        lines: [{ description: "Anything", quantity: "1", unitPrice: "1" }],
      })
      .expect(400);

    const quotation = (
      await request(app.getHttpServer())
        .post("/ap/quotations")
        .set(auth(ctx.accessToken))
        .send({
          businessPartnerId: ctx.vendor.id,
          quotationDate: new Date().toISOString(),
          lines: [{ description: "Anything", quantity: "1", unitPrice: "1" }],
        })
        .expect(201)
    ).body;

    await request(app.getHttpServer())
      .post(`/ap/orders/from-quotation/${quotation.id}`)
      .set(auth(ctx.accessToken))
      .expect(201);

    // Already CONVERTED — cannot cancel
    await request(app.getHttpServer()).post(`/ap/quotations/${quotation.id}/cancel`).set(auth(ctx.accessToken)).expect(409);
  });

  it("isolates quotations and orders between companies", async () => {
    const a = await setupContext();
    await request(app.getHttpServer())
      .post("/ap/quotations")
      .set(auth(a.accessToken))
      .send({
        businessPartnerId: a.vendor.id,
        quotationDate: new Date().toISOString(),
        lines: [{ description: "A only", quantity: "1", unitPrice: "1" }],
      })
      .expect(201);

    const b = await setupUserWithCompany(app);
    const bAccessToken = await grantModules(app, b, ["purchase"]);
    const bQuotations = (
      await request(app.getHttpServer()).get("/ap/quotations").set(auth(bAccessToken)).expect(200)
    ).body;
    expect(bQuotations).toHaveLength(0);
    const bOrders = (await request(app.getHttpServer()).get("/ap/orders").set(auth(bAccessToken)).expect(200)).body;
    expect(bOrders).toHaveLength(0);
  });
});
