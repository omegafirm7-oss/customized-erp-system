import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, createItem, createPartner, createWarehouse, grantModules, setupUserWithCompany } from "./utils/test-app";

describe("Purchase cycle extension — Requisition → RFQ → PO → GRN/QC → Invoice (e2e)", () => {
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
    const accessToken = await grantModules(app, ctx, ["purchase"]);
    const vendorA = await createPartner(app, accessToken, "VENDOR");
    const vendorB = await createPartner(app, accessToken, "VENDOR");
    const expenseAccount = ctx.accountByCode("5240");
    const item = await createItem(app, accessToken, { defaultPurchaseAccountId: expenseAccount.id });
    const warehouse = await createWarehouse(app, accessToken);
    return { ...ctx, accessToken, vendorA, vendorB, item, warehouse };
  }

  it("runs the full chain: requisition -> two RFQs -> convert one -> GRN -> QC -> complete -> invoice, with a non-blocking three-way-match warning on a short receipt", async () => {
    const ctx = await setupContext();
    const server = app.getHttpServer();

    // 1) Create + submit + approve requisition
    const requisition = (
      await request(server)
        .post("/procurement/requisitions")
        .set(auth(ctx.accessToken))
        .send({ lines: [{ itemId: ctx.item.id, description: "20 units of widget", quantity: "20" }] })
        .expect(201)
    ).body;
    expect(requisition.status).toBe("DRAFT");

    await request(server).post(`/procurement/requisitions/${requisition.id}/submit`).set(auth(ctx.accessToken)).expect(201);
    const submitted = (
      await request(server).get(`/procurement/requisitions/${requisition.id}`).set(auth(ctx.accessToken)).expect(200)
    ).body;
    expect(submitted.status).toBe("PENDING_APPROVAL");
    expect(submitted.requisitionNumber).toMatch(/^PR-/);

    await request(server).post(`/procurement/requisitions/${requisition.id}/approve`).set(auth(ctx.accessToken)).expect(201);

    // 2) Send RFQ to two vendors (multi-vendor comparison)
    const rfqA = (
      await request(server)
        .post(`/procurement/requisitions/${requisition.id}/send-rfq`)
        .set(auth(ctx.accessToken))
        .send({ businessPartnerId: ctx.vendorA.id, quotationDate: new Date().toISOString() })
        .expect(201)
    ).body;
    const rfqB = (
      await request(server)
        .post(`/procurement/requisitions/${requisition.id}/send-rfq`)
        .set(auth(ctx.accessToken))
        .send({ businessPartnerId: ctx.vendorB.id, quotationDate: new Date().toISOString() })
        .expect(201)
    ).body;
    expect(rfqA.sourceRequisitionId).toBe(requisition.id);
    expect(rfqB.sourceRequisitionId).toBe(requisition.id);

    // 3) Convert vendor A's RFQ to a PO
    const order = (
      await request(server).post(`/ap/orders/from-quotation/${rfqA.id}`).set(auth(ctx.accessToken)).expect(201)
    ).body;
    expect(Number(order.lines[0].quantity)).toBe(20);

    // Sibling RFQ auto-marked NOT_SELECTED, requisition auto-CLOSED
    const reqAfter = (
      await request(server).get(`/procurement/requisitions/${requisition.id}`).set(auth(ctx.accessToken)).expect(200)
    ).body;
    expect(reqAfter.status).toBe("CLOSED");
    const siblingB = reqAfter.quotations.find((q: any) => q.id === rfqB.id);
    expect(siblingB.status).toBe("NOT_SELECTED");
    const chosenA = reqAfter.quotations.find((q: any) => q.id === rfqA.id);
    expect(chosenA.status).toBe("CONVERTED");

    // 4) Goods receipt — only receive 15 of the 20 ordered
    const receipt = (
      await request(server)
        .post("/procurement/goods-receipts")
        .set(auth(ctx.accessToken))
        .send({ purchaseOrderId: order.id, warehouseId: ctx.warehouse.id, receivedDate: new Date().toISOString() })
        .expect(201)
    ).body;
    expect(Number(receipt.lines[0].quantityReceived)).toBe(20); // prefilled to full remaining qty

    const line = receipt.lines[0];
    await request(server)
      .post(`/procurement/goods-receipts/${receipt.id}/lines/${line.id}`)
      .set(auth(ctx.accessToken))
      .send({ quantityReceived: "15" })
      .expect(201);

    await request(server).post(`/procurement/goods-receipts/${receipt.id}/submit-for-qc`).set(auth(ctx.accessToken)).expect(201);

    // Completing before QC is recorded is rejected
    await request(server).post(`/procurement/goods-receipts/${receipt.id}/complete`).set(auth(ctx.accessToken)).expect(400);

    await request(server)
      .post(`/procurement/goods-receipts/${receipt.id}/lines/${line.id}/qc`)
      .set(auth(ctx.accessToken))
      .send({ qcResult: "PASSED", quantityAccepted: "15", quantityRejected: "0" })
      .expect(201);

    await request(server).post(`/procurement/goods-receipts/${receipt.id}/complete`).set(auth(ctx.accessToken)).expect(201);

    const orderAfterGrn = (
      await request(server).get(`/ap/orders/${order.id}`).set(auth(ctx.accessToken)).expect(200)
    ).body;
    expect(Number(orderAfterGrn.lines[0].receivedQuantity)).toBe(15);
    // Receiving never touches invoicedQuantity/status — stock/GL posting still
    // happens only at invoice time, exactly as before this feature existed.
    expect(Number(orderAfterGrn.lines[0].invoicedQuantity)).toBe(0);
    expect(orderAfterGrn.status).toBe("SENT");

    // 5) Three-way-match warning: invoicing the full 20 vs only 15 accepted
    const warning = (
      await request(server).get(`/ap/orders/${order.id}/three-way-match-warning`).set(auth(ctx.accessToken)).expect(200)
    ).body;
    expect(warning.mismatches).toHaveLength(1);
    expect(Number(warning.mismatches[0].quantityToInvoice)).toBe(20);
    expect(Number(warning.mismatches[0].quantityAccepted)).toBe(15);

    // 6) Generating the invoice is NOT blocked by the mismatch (non-blocking warning)
    const invoice = (
      await request(server)
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

    const orderAfterInvoice = (
      await request(server).get(`/ap/orders/${order.id}`).set(auth(ctx.accessToken)).expect(200)
    ).body;
    expect(orderAfterInvoice.status).toBe("INVOICED");
    expect(Number(orderAfterInvoice.lines[0].invoicedQuantity)).toBe(20);
  });

  it("rejects a requisition and blocks sending an RFQ from a non-approved requisition", async () => {
    const ctx = await setupContext();
    const server = app.getHttpServer();

    const requisition = (
      await request(server)
        .post("/procurement/requisitions")
        .set(auth(ctx.accessToken))
        .send({ lines: [{ description: "Anything", quantity: "1" }] })
        .expect(201)
    ).body;

    // Cannot send RFQ from a draft requisition
    await request(server)
      .post(`/procurement/requisitions/${requisition.id}/send-rfq`)
      .set(auth(ctx.accessToken))
      .send({ businessPartnerId: ctx.vendorA.id, quotationDate: new Date().toISOString() })
      .expect(409);

    await request(server).post(`/procurement/requisitions/${requisition.id}/submit`).set(auth(ctx.accessToken)).expect(201);
    await request(server)
      .post(`/procurement/requisitions/${requisition.id}/reject`)
      .set(auth(ctx.accessToken))
      .send({ reason: "Not needed right now" })
      .expect(201);

    const rejected = (
      await request(server).get(`/procurement/requisitions/${requisition.id}`).set(auth(ctx.accessToken)).expect(200)
    ).body;
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.rejectionReason).toBe("Not needed right now");
  });

  it("isolates requisitions and goods receipts between companies", async () => {
    const a = await setupContext();
    const server = app.getHttpServer();
    await request(server)
      .post("/procurement/requisitions")
      .set(auth(a.accessToken))
      .send({ lines: [{ description: "A only", quantity: "1" }] })
      .expect(201);

    const b = await setupUserWithCompany(app);
    const bAccessToken = await grantModules(app, b, ["purchase"]);
    const bRequisitions = (
      await request(server).get("/procurement/requisitions").set(auth(bAccessToken)).expect(200)
    ).body;
    expect(bRequisitions).toHaveLength(0);
    const bReceipts = (
      await request(server).get("/procurement/goods-receipts").set(auth(bAccessToken)).expect(200)
    ).body;
    expect(bReceipts).toHaveLength(0);
  });
});
