import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, createItem, createPartner, setupUserWithCompany } from "./utils/test-app";

describe("Profit or Loss / Financial Position project filter (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (token: string, url: string) => request(app.getHttpServer()).get(url).set("Authorization", `Bearer ${token}`);

  it("limits both statements to the journal lines stamped with the project's cost center", async () => {
    const ctx = await setupUserWithCompany(app);
    const vendor = await createPartner(app, ctx.accessToken, "VENDOR");
    const item = await createItem(app, ctx.accessToken, { defaultPurchaseAccountId: ctx.accountByCode("5240").id });
    const customer = await createPartner(app, ctx.accessToken, "CUSTOMER");

    const project = (
      await request(app.getHttpServer())
        .post("/projects")
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .send({ code: "PF-1", name: "Filter Project", businessPartnerId: customer.id, recognitionMethod: "OVER_TIME", contractValue: "100000", estimatedTotalCost: "60000" })
        .expect(201)
    ).body;
    await request(app.getHttpServer()).post(`/projects/${project.id}/status`).set("Authorization", `Bearer ${ctx.accessToken}`).send({ status: "ACTIVE" }).expect(201);

    const today = new Date().toISOString();
    const postCost = async (net: string, projectId?: string) => {
      const draft = await request(app.getHttpServer())
        .post("/ap/invoices")
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .send({
          businessPartnerId: vendor.id,
          vendorInvoiceNumber: `V-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          postingDate: today,
          dueDate: today,
          lines: [{ itemId: item.id, description: "Cost", quantity: "1", unitPrice: net, projectId }],
        })
        .expect(201);
      await request(app.getHttpServer()).post(`/ap/invoices/${draft.body.id}/post`).set("Authorization", `Bearer ${ctx.accessToken}`).expect(201);
    };
    await postCost("1000", project.id);
    await postCost("300");

    const range = "fromDate=2020-01-01T00:00:00.000Z&toDate=2099-12-31T00:00:00.000Z";
    const whole = (await get(ctx.accessToken, `/reports/profit-or-loss?${range}`).expect(200)).body;
    const scoped = (await get(ctx.accessToken, `/reports/profit-or-loss?${range}&projectId=${project.id}`).expect(200)).body;
    expect(Number(whole.operatingExpense)).toBe(1300);
    expect(Number(scoped.operatingExpense)).toBe(1000);
    expect(scoped.project).toMatchObject({ code: "PF-1", name: "Filter Project" });

    // drill-down totals follow the same filter
    const detail = (await get(ctx.accessToken, `/reports/profit-or-loss/line-detail?line=operatingExpense&${range}&projectId=${project.id}`).expect(200)).body;
    expect(Number(detail.total)).toBe(1000);
    const txns = (
      await get(ctx.accessToken, `/reports/accounts/${ctx.accountByCode("5240").id}/transactions?${range}&projectId=${project.id}`).expect(200)
    ).body;
    expect(txns.transactions).toHaveLength(1);
    expect(Number(txns.totalDebit)).toBe(1000);

    // balance sheet: only lines stamped with the project; carries the project label
    const bsWhole = (await get(ctx.accessToken, `/reports/financial-position?asOfDate=2099-12-31`).expect(200)).body;
    const bsScoped = (await get(ctx.accessToken, `/reports/financial-position?asOfDate=2099-12-31&projectId=${project.id}`).expect(200)).body;
    expect(bsWhole.project).toBeUndefined();
    expect(bsScoped.project).toMatchObject({ code: "PF-1" });
    expect(bsScoped.equity.find((l: any) => l.subClassCode === "CURRENT_YEAR_EARNINGS").balance).toBe("-1000.00");
    expect(bsWhole.equity.find((l: any) => l.subClassCode === "CURRENT_YEAR_EARNINGS").balance).toBe("-1300.00");

    // an unknown project is rejected
    await get(ctx.accessToken, `/reports/profit-or-loss?${range}&projectId=00000000-0000-0000-0000-000000000000`).expect(404);
  });

  it("shows the attached evidence and supplier invoice number on the expense transactions behind a statement line", async () => {
    const ctx = await setupUserWithCompany(app);
    const vendor = await createPartner(app, ctx.accessToken, "VENDOR");
    const item = await createItem(app, ctx.accessToken, { defaultPurchaseAccountId: ctx.accountByCode("5240").id });
    const today = new Date().toISOString();

    const draft = (
      await request(app.getHttpServer())
        .post("/ap/invoices")
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .send({
          businessPartnerId: vendor.id,
          vendorInvoiceNumber: "SUP-777",
          postingDate: today,
          dueDate: today,
          lines: [{ itemId: item.id, description: "With receipt", quantity: "1", unitPrice: "500" }],
        })
        .expect(201)
    ).body;
    const lineId = draft.lines[0].id;
    await request(app.getHttpServer())
      .post(`/ap/invoices/lines/${lineId}/attachment`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .attach("file", Buffer.from("%PDF-1.4 test receipt"), { filename: "receipt.pdf", contentType: "application/pdf" })
      .expect(201);
    await request(app.getHttpServer()).post(`/ap/invoices/${draft.id}/post`).set("Authorization", `Bearer ${ctx.accessToken}`).expect(201);

    const range = "fromDate=2020-01-01T00:00:00.000Z&toDate=2099-12-31T00:00:00.000Z";
    const txns = (await get(ctx.accessToken, `/reports/accounts/${ctx.accountByCode("5240").id}/transactions?${range}`).expect(200)).body;
    expect(txns.transactions).toHaveLength(1);
    expect(txns.transactions[0].supplierInvoice).toBe("SUP-777");
    expect(txns.transactions[0].evidence).toEqual([{ lineId, filename: "receipt.pdf", mimeType: "application/pdf" }]);
  });
});
