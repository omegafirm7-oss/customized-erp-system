import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, createItem, createPartner, createWarehouse, setupUserWithCompany } from "./utils/test-app";

describe("Trading & Inventory (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Company with a customer, a vendor, and one inventory item. */
  async function setupInventoryContext() {
    const ctx = await setupUserWithCompany(app);
    const customer = await createPartner(app, ctx.accessToken, "CUSTOMER");
    const vendor = await createPartner(app, ctx.accessToken, "VENDOR");
    const item = await createItem(app, ctx.accessToken, {
      itemType: "INVENTORY",
      isInventoryItem: true,
      defaultSalesAccountId: ctx.accountByCode("4100").id,
    });
    const warehouses = await request(app.getHttpServer())
      .get("/warehouses")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(200);
    const mainWarehouse = warehouses.body.find((w: any) => w.isDefault);
    return { ...ctx, customer, vendor, item, mainWarehouse };
  }

  async function postApInvoice(ctx: any, qty: string, unitPrice: string) {
    const today = new Date().toISOString();
    const draft = await request(app.getHttpServer())
      .post("/ap/invoices")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        businessPartnerId: ctx.vendor.id,
        vendorInvoiceNumber: `VND-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        postingDate: today,
        dueDate: today,
        lines: [{ itemId: ctx.item.id, description: "Goods purchase", quantity: qty, unitPrice }],
      })
      .expect(201);
    const posted = await request(app.getHttpServer())
      .post(`/ap/invoices/${draft.body.id}/post`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(201);
    return posted.body;
  }

  async function postArInvoice(ctx: any, qty: string, unitPrice = "50") {
    const today = new Date().toISOString();
    const draft = await request(app.getHttpServer())
      .post("/ar/invoices")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        businessPartnerId: ctx.customer.id,
        issueDateTime: today,
        postingDate: today,
        dueDate: today,
        lines: [{ itemId: ctx.item.id, description: "Goods sale", quantity: qty, unitPrice }],
      })
      .expect(201);
    return request(app.getHttpServer())
      .post(`/ar/invoices/${draft.body.id}/post`)
      .set("Authorization", `Bearer ${ctx.accessToken}`);
  }

  async function getStock(ctx: any) {
    const res = await request(app.getHttpServer())
      .get(`/inventory/stock?itemId=${ctx.item.id}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(200);
    return res.body;
  }

  async function getJe(ctx: any, journalEntryId: string) {
    const res = await request(app.getHttpServer())
      .get(`/gl/journal-entries/${journalEntryId}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(200);
    return res.body;
  }

  it("AP receipt: stock and JE hit inventory at the invoice net (10 @ 10.00)", async () => {
    const ctx = await setupInventoryContext();
    const invoice = await postApInvoice(ctx, "10", "10.00");

    const stock = await getStock(ctx);
    expect(stock).toHaveLength(1);
    expect(Number(stock[0].onHandQty)).toBe(10);
    expect(Number(stock[0].avgCost)).toBe(10);
    expect(Number(stock[0].totalValue)).toBe(100);

    // JE debits 1310 (inventory), NOT an expense account
    const je = await getJe(ctx, invoice.journalEntryId);
    const line1310 = je.lines.find((l: any) => l.account.code === "1310");
    expect(Number(line1310.debit)).toBe(100);
    expect(je.lines.some((l: any) => l.account.code === "5240")).toBe(false);
  });

  it("moving weighted average: second receipt at 14.00 → avg 12.000000", async () => {
    const ctx = await setupInventoryContext();
    await postApInvoice(ctx, "10", "10.00");
    await postApInvoice(ctx, "10", "14.00");

    const stock = await getStock(ctx);
    expect(Number(stock[0].onHandQty)).toBe(20);
    expect(Number(stock[0].avgCost)).toBe(12);
    expect(Number(stock[0].totalValue)).toBe(240);
  });

  it("AR issue: COGS at average cost in the same JE (sell 5 → COGS 60)", async () => {
    const ctx = await setupInventoryContext();
    await postApInvoice(ctx, "10", "10.00");
    await postApInvoice(ctx, "10", "14.00");

    const posted = await postArInvoice(ctx, "5", "50");
    expect(posted.status).toBe(201);

    const stock = await getStock(ctx);
    expect(Number(stock[0].onHandQty)).toBe(15);
    expect(Number(stock[0].avgCost)).toBe(12);
    expect(Number(stock[0].totalValue)).toBe(180);

    const je = await getJe(ctx, posted.body.journalEntryId);
    const cogsLine = je.lines.find((l: any) => l.account.code === "5100");
    const invLine = je.lines.find((l: any) => l.account.code === "1310");
    expect(Number(cogsLine.debit)).toBe(60);
    expect(Number(invLine.credit)).toBe(60);
    // Revenue still intact (5 × 50 = 250)
    const revLine = je.lines.find((l: any) => l.account.code === "4100");
    expect(Number(revLine.credit)).toBe(250);
  });

  it("negative stock is blocked: 409 names item/warehouse/available; nothing posts", async () => {
    const ctx = await setupInventoryContext();
    await postApInvoice(ctx, "10", "10.00");

    const res = await postArInvoice(ctx, "20");
    expect(res.status).toBe(409);
    expect(res.body.message).toContain(ctx.item.code);
    expect(res.body.message).toContain("available 10");

    // Invoice stays DRAFT, no movements, stock untouched — tx rolled back
    const invoices = await request(app.getHttpServer())
      .get("/ar/invoices?status=DRAFT")
      .set("Authorization", `Bearer ${ctx.accessToken}`);
    expect(invoices.body).toHaveLength(1);
    const stock = await getStock(ctx);
    expect(Number(stock[0].onHandQty)).toBe(10);
    const movements = await request(app.getHttpServer())
      .get(`/inventory/movements?itemId=${ctx.item.id}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`);
    expect(movements.body.filter((m: any) => m.movementType === "ISSUE")).toHaveLength(0);
  });

  it("transfer moves quantity between warehouses at cost with no JE", async () => {
    const ctx = await setupInventoryContext();
    await postApInvoice(ctx, "10", "12.00");
    const wh2 = await createWarehouse(app, ctx.accessToken);

    const jesBefore = await request(app.getHttpServer())
      .get("/gl/journal-entries")
      .set("Authorization", `Bearer ${ctx.accessToken}`);

    const transfer = await request(app.getHttpServer())
      .post("/inventory/transfers")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        fromWarehouseId: ctx.mainWarehouse.id,
        toWarehouseId: wh2.id,
        postingDate: new Date().toISOString(),
        lines: [{ itemId: ctx.item.id, quantity: "5" }],
      })
      .expect(201);
    expect(transfer.body.transferNumber).toBe("ST-000001");
    expect(Number(transfer.body.lines[0].unitCost)).toBe(12);

    const stock = await getStock(ctx);
    const main = stock.find((s: any) => s.warehouseId === ctx.mainWarehouse.id);
    const secondary = stock.find((s: any) => s.warehouseId === wh2.id);
    expect(Number(main.onHandQty)).toBe(5);
    expect(Number(main.totalValue)).toBe(60);
    expect(Number(secondary.onHandQty)).toBe(5);
    expect(Number(secondary.totalValue)).toBe(60);

    // No new JE from the transfer
    const jesAfter = await request(app.getHttpServer())
      .get("/gl/journal-entries")
      .set("Authorization", `Bearer ${ctx.accessToken}`);
    expect(jesAfter.body.length).toBe(jesBefore.body.length);
  });

  it("adjustments post 5150 JEs: OUT 2 pcs @avg, IN 3 @ 9.00", async () => {
    const ctx = await setupInventoryContext();
    await postApInvoice(ctx, "10", "12.00");

    const out = await request(app.getHttpServer())
      .post("/inventory/adjustments")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        warehouseId: ctx.mainWarehouse.id,
        direction: "OUT",
        postingDate: new Date().toISOString(),
        reason: "Damaged goods write-off",
        lines: [{ itemId: ctx.item.id, quantity: "2" }],
      })
      .expect(201);
    expect(out.body.adjustmentNumber).toBe("ADJ-000001");
    const outJe = await getJe(ctx, out.body.journalEntryId);
    expect(Number(outJe.lines.find((l: any) => l.account.code === "5150").debit)).toBe(24);
    expect(Number(outJe.lines.find((l: any) => l.account.code === "1310").credit)).toBe(24);

    const inn = await request(app.getHttpServer())
      .post("/inventory/adjustments")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        warehouseId: ctx.mainWarehouse.id,
        direction: "IN",
        postingDate: new Date().toISOString(),
        reason: "Found stock during count",
        lines: [{ itemId: ctx.item.id, quantity: "3", unitCost: "9.00" }],
      })
      .expect(201);
    const inJe = await getJe(ctx, inn.body.journalEntryId);
    expect(Number(inJe.lines.find((l: any) => l.account.code === "1310").debit)).toBe(27);
    expect(Number(inJe.lines.find((l: any) => l.account.code === "5150").credit)).toBe(27);

    // Stock: 10 - 2 + 3 = 11; value: 120 - 24 + 27 = 123
    const stock = await getStock(ctx);
    expect(Number(stock[0].onHandQty)).toBe(11);
    expect(Number(stock[0].totalValue)).toBe(123);
  });

  it("AR cancel returns stock at the issued cost", async () => {
    const ctx = await setupInventoryContext();
    await postApInvoice(ctx, "10", "12.00");
    const posted = (await postArInvoice(ctx, "5")).body;

    let stock = await getStock(ctx);
    expect(Number(stock[0].onHandQty)).toBe(5);

    await request(app.getHttpServer())
      .post(`/ar/invoices/${posted.id}/cancel`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(201);

    stock = await getStock(ctx);
    expect(Number(stock[0].onHandQty)).toBe(10);
    expect(Number(stock[0].totalValue)).toBe(120);
    expect(Number(stock[0].avgCost)).toBe(12);
  });

  it("AP cancel is blocked with 409 once the received goods were sold", async () => {
    const ctx = await setupInventoryContext();
    const apInvoice = await postApInvoice(ctx, "10", "12.00");
    await postArInvoice(ctx, "8"); // 2 left of the 10 received

    const res = await request(app.getHttpServer())
      .post(`/ap/invoices/${apInvoice.id}/cancel`)
      .set("Authorization", `Bearer ${ctx.accessToken}`);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain("Insufficient stock");

    // With stock intact, cancel succeeds
    const ctx2 = await setupInventoryContext();
    const apInvoice2 = await postApInvoice(ctx2, "10", "12.00");
    await request(app.getHttpServer())
      .post(`/ap/invoices/${apInvoice2.id}/cancel`)
      .set("Authorization", `Bearer ${ctx2.accessToken}`)
      .expect(201);
    const stock2 = await getStock(ctx2);
    expect(Number(stock2[0].onHandQty)).toBe(0);
    expect(Number(stock2[0].totalValue)).toBe(0);
  });

  it("concurrency: stock 5, two parallel sales of 4 → exactly one succeeds", async () => {
    const ctx = await setupInventoryContext();
    await postApInvoice(ctx, "5", "10.00");

    const today = new Date().toISOString();
    const draftIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const draft = await request(app.getHttpServer())
        .post("/ar/invoices")
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .send({
          businessPartnerId: ctx.customer.id,
          issueDateTime: today,
          postingDate: today,
          dueDate: today,
          lines: [{ itemId: ctx.item.id, description: `Race ${i}`, quantity: "4", unitPrice: "50" }],
        })
        .expect(201);
      draftIds.push(draft.body.id);
    }

    const results = await Promise.allSettled(
      draftIds.map((id) =>
        request(app.getHttpServer())
          .post(`/ar/invoices/${id}/post`)
          .set("Authorization", `Bearer ${ctx.accessToken}`)
          .then((r) => r.status),
      ),
    );
    const statuses = results.map((r) => (r.status === "fulfilled" ? r.value : 500));
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(1);

    const stock = await getStock(ctx);
    expect(Number(stock[0].onHandQty)).toBe(1); // 5 - 4, no oversell
  });

  it("stock summary total reconciles to the GL 1310 balance after mixed operations", async () => {
    const ctx = await setupInventoryContext();
    await postApInvoice(ctx, "10", "10.00");
    await postApInvoice(ctx, "10", "14.00");
    await postArInvoice(ctx, "5");
    const wh2 = await createWarehouse(app, ctx.accessToken);
    await request(app.getHttpServer())
      .post("/inventory/transfers")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        fromWarehouseId: ctx.mainWarehouse.id,
        toWarehouseId: wh2.id,
        postingDate: new Date().toISOString(),
        lines: [{ itemId: ctx.item.id, quantity: "3" }],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post("/inventory/adjustments")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        warehouseId: ctx.mainWarehouse.id,
        direction: "OUT",
        postingDate: new Date().toISOString(),
        reason: "Shrinkage write-off",
        lines: [{ itemId: ctx.item.id, quantity: "1" }],
      })
      .expect(201);

    const summary = await request(app.getHttpServer())
      .get("/reports/stock-summary")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(200);

    const tb = await request(app.getHttpServer())
      .get("/reports/trial-balance")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(200);
    const gl1310 = tb.body.rows.find((r: any) => r.accountCode === "1310");

    expect(Number(summary.body.totalValue)).toBeCloseTo(Number(gl1310.closingBalance), 4);
    // Explicit: 240 - 60 (COGS) - 12 (adjustment) = 168; transfer is value-neutral
    expect(Number(summary.body.totalValue)).toBe(168);
  });

  it("full drain leaves exactly zero value", async () => {
    const ctx = await setupInventoryContext();
    await postApInvoice(ctx, "3", "9.99"); // value 29.97, awkward rounding
    const posted = await postArInvoice(ctx, "3");
    expect(posted.status).toBe(201);

    const stock = await getStock(ctx);
    expect(Number(stock[0].onHandQty)).toBe(0);
    expect(Number(stock[0].totalValue)).toBe(0);
  });

  it("service items cause no stock movements", async () => {
    const ctx = await setupInventoryContext();
    const serviceItem = await createItem(app, ctx.accessToken, {
      defaultSalesAccountId: ctx.accountByCode("4200").id,
      defaultPurchaseAccountId: ctx.accountByCode("5240").id,
    });
    const today = new Date().toISOString();
    const draft = await request(app.getHttpServer())
      .post("/ar/invoices")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        businessPartnerId: ctx.customer.id,
        issueDateTime: today,
        postingDate: today,
        dueDate: today,
        lines: [{ itemId: serviceItem.id, description: "Consulting", quantity: "1", unitPrice: "500" }],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/ar/invoices/${draft.body.id}/post`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(201);

    const movements = await request(app.getHttpServer())
      .get(`/inventory/movements?itemId=${serviceItem.id}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`);
    expect(movements.body).toHaveLength(0);
  });

  it("credit note returns stock at the original issue cost with Dr Inventory / Cr COGS", async () => {
    const ctx = await setupInventoryContext();
    await postApInvoice(ctx, "10", "12.00");
    const invoice = (await postArInvoice(ctx, "5", "50")).body; // issued at 12

    // Receive more at a different cost so current avg changes (validates that
    // the CN uses the ORIGINAL issue cost, not the new average)
    await postApInvoice(ctx, "10", "20.00");

    const cnDraft = await request(app.getHttpServer())
      .post("/ar/invoices")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        documentKind: "CREDIT_NOTE",
        originalInvoiceId: invoice.id,
        businessPartnerId: ctx.customer.id,
        issueDateTime: new Date().toISOString(),
        postingDate: new Date().toISOString(),
        dueDate: new Date().toISOString(),
        lines: [{ itemId: ctx.item.id, description: "Return", quantity: "2", unitPrice: "50" }],
      })
      .expect(201);
    const cn = await request(app.getHttpServer())
      .post(`/ar/invoices/${cnDraft.body.id}/post`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(201);

    const je = await getJe(ctx, cn.body.journalEntryId);
    // Return of 2 @ original issue cost 12 = 24
    expect(Number(je.lines.find((l: any) => l.account.code === "1310").debit)).toBe(24);
    expect(Number(je.lines.find((l: any) => l.account.code === "5100").credit)).toBe(24);
  });
});
