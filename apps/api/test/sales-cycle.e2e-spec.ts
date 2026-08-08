import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, createItem, createPartner, grantModules, setupUserWithCompany } from "./utils/test-app";

describe("Sales & Marketing cycle — Quotation → Order → Invoice (e2e)", () => {
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
    // module-entitlement.e2e-spec.ts) — this suite exercises the Sales &
    // Marketing module's actual behavior, so grant it explicitly, as a
    // platform admin would via the Platform Dashboard.
    const accessToken = await grantModules(app, ctx, ["sales"]);
    const customer = await createPartner(app, accessToken, "CUSTOMER");
    const revenueAccount = ctx.accountByCode("4100");
    const item = await createItem(app, accessToken, { defaultSalesAccountId: revenueAccount.id });
    return { ...ctx, accessToken, customer, item };
  }

  it("creates a quotation, converts it to a sales order, and generates a sales invoice from it", async () => {
    const ctx = await setupContext();

    const quotation = (
      await request(app.getHttpServer())
        .post("/ar/quotations")
        .set(auth(ctx.accessToken))
        .send({
          businessPartnerId: ctx.customer.id,
          quotationDate: new Date().toISOString(),
          lines: [{ itemId: ctx.item.id, description: "Consulting hours", quantity: "10", unitPrice: "100" }],
        })
        .expect(201)
    ).body;
    expect(quotation.quotationNumber).toMatch(/^SQ-/);
    expect(quotation.status).toBe("SENT");

    const order = (
      await request(app.getHttpServer())
        .post(`/ar/orders/from-quotation/${quotation.id}`)
        .set(auth(ctx.accessToken))
        .expect(201)
    ).body;
    expect(order.orderNumber).toMatch(/^SO-/);
    expect(order.status).toBe("CONFIRMED");
    expect(order.sourceQuotationId).toBe(quotation.id);
    expect(order.lines).toHaveLength(1);
    expect(Number(order.lines[0].quantity)).toBe(10);
    expect(Number(order.lines[0].invoicedQuantity)).toBe(0);

    const quotationAfter = (
      await request(app.getHttpServer()).get(`/ar/quotations/${quotation.id}`).set(auth(ctx.accessToken)).expect(200)
    ).body;
    expect(quotationAfter.status).toBe("CONVERTED");

    // Converting again is rejected
    await request(app.getHttpServer())
      .post(`/ar/orders/from-quotation/${quotation.id}`)
      .set(auth(ctx.accessToken))
      .expect(409);

    const invoice = (
      await request(app.getHttpServer())
        .post(`/ar/orders/${order.id}/generate-invoice`)
        .set(auth(ctx.accessToken))
        .send({
          issueDateTime: new Date().toISOString(),
          postingDate: new Date().toISOString(),
          dueDate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        })
        .expect(201)
    ).body;
    expect(invoice.status).toBe("DRAFT");
    expect(Number(invoice.netTotal)).toBe(1000); // 10 x 100
    const invoiceFull = (
      await request(app.getHttpServer()).get(`/ar/invoices/${invoice.id}`).set(auth(ctx.accessToken)).expect(200)
    ).body;
    expect(invoiceFull.sourceSalesOrderId).toBe(order.id);

    const orderAfter = (
      await request(app.getHttpServer()).get(`/ar/orders/${order.id}`).set(auth(ctx.accessToken)).expect(200)
    ).body;
    expect(orderAfter.status).toBe("INVOICED");
    expect(Number(orderAfter.lines[0].invoicedQuantity)).toBe(10);

    // Fully invoiced — generating again is rejected
    await request(app.getHttpServer())
      .post(`/ar/orders/${order.id}/generate-invoice`)
      .set(auth(ctx.accessToken))
      .send({
        issueDateTime: new Date().toISOString(),
        postingDate: new Date().toISOString(),
        dueDate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      })
      .expect(409);

    // Fully invoiced order cannot be cancelled
    await request(app.getHttpServer()).post(`/ar/orders/${order.id}/cancel`).set(auth(ctx.accessToken)).expect(409);
  });

  it("creates a sales order directly, without a quotation", async () => {
    const ctx = await setupContext();

    const order = (
      await request(app.getHttpServer())
        .post("/ar/orders")
        .set(auth(ctx.accessToken))
        .send({
          businessPartnerId: ctx.customer.id,
          orderDate: new Date().toISOString(),
          lines: [{ description: "Ad-hoc service", quantity: "5", unitPrice: "200" }],
        })
        .expect(201)
    ).body;
    expect(order.sourceQuotationId).toBeNull();
    expect(order.status).toBe("CONFIRMED");

    // A DRAFT-free direct order can be cancelled cleanly before any invoicing
    const cancelled = (
      await request(app.getHttpServer()).post(`/ar/orders/${order.id}/cancel`).set(auth(ctx.accessToken)).expect(201)
    ).body;
    expect(cancelled.status).toBe("CANCELLED");

    // Cancelling again is rejected
    await request(app.getHttpServer()).post(`/ar/orders/${order.id}/cancel`).set(auth(ctx.accessToken)).expect(409);
  });

  it("rejects a quotation for a vendor-only partner and blocks cancelling an already-converted quotation", async () => {
    const ctx = await setupContext();
    const vendorOnly = await createPartner(app, ctx.accessToken, "VENDOR");

    await request(app.getHttpServer())
      .post("/ar/quotations")
      .set(auth(ctx.accessToken))
      .send({
        businessPartnerId: vendorOnly.id,
        quotationDate: new Date().toISOString(),
        lines: [{ description: "Anything", quantity: "1", unitPrice: "1" }],
      })
      .expect(400);

    const quotation = (
      await request(app.getHttpServer())
        .post("/ar/quotations")
        .set(auth(ctx.accessToken))
        .send({
          businessPartnerId: ctx.customer.id,
          quotationDate: new Date().toISOString(),
          lines: [{ description: "Anything", quantity: "1", unitPrice: "1" }],
        })
        .expect(201)
    ).body;

    await request(app.getHttpServer())
      .post(`/ar/orders/from-quotation/${quotation.id}`)
      .set(auth(ctx.accessToken))
      .expect(201);

    // Already CONVERTED — cannot cancel
    await request(app.getHttpServer()).post(`/ar/quotations/${quotation.id}/cancel`).set(auth(ctx.accessToken)).expect(409);
  });

  it("isolates quotations and orders between companies, and requires the sales module even with valid permissions", async () => {
    const a = await setupContext();
    await request(app.getHttpServer())
      .post("/ar/quotations")
      .set(auth(a.accessToken))
      .send({
        businessPartnerId: a.customer.id,
        quotationDate: new Date().toISOString(),
        lines: [{ description: "A only", quantity: "1", unitPrice: "1" }],
      })
      .expect(201);

    const b = await setupUserWithCompany(app);
    const bAccessToken = await grantModules(app, b, ["sales"]);
    const bQuotations = (
      await request(app.getHttpServer()).get("/ar/quotations").set(auth(bAccessToken)).expect(200)
    ).body;
    expect(bQuotations).toHaveLength(0);
    const bOrders = (await request(app.getHttpServer()).get("/ar/orders").set(auth(bAccessToken)).expect(200)).body;
    expect(bOrders).toHaveLength(0);

    // A company with no "sales" entitlement gets 403 even with a valid Administrator role.
    const c = await setupUserWithCompany(app);
    await request(app.getHttpServer()).get("/ar/quotations").set(auth(c.accessToken)).expect(403);
    await request(app.getHttpServer()).get("/ar/orders").set(auth(c.accessToken)).expect(403);
  });
});
