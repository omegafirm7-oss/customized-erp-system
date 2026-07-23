import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, createPartner, setupUserWithCompany } from "./utils/test-app";

describe("AP invoice editing + project cost breakdown (e2e)", () => {
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

  it("edits a draft invoice's amount, account and VAT category, recomputing totals", async () => {
    const ctx = await setupUserWithCompany(app);
    const vendor = await createPartner(app, ctx.accessToken, "VENDOR");
    const account1 = ctx.accountByCode("5240");
    const account2 = ctx.accountByCode("5210");

    const created = (
      await request(app.getHttpServer())
        .post("/ap/invoices")
        .set(auth(ctx.accessToken))
        .send({
          businessPartnerId: vendor.id,
          vendorInvoiceNumber: "EDIT-001",
          postingDate: new Date().toISOString(),
          dueDate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
          lines: [{ description: "Original", quantity: "1", unitPrice: "100", vatCategory: "STANDARD_15", accountId: account1.id }],
        })
        .expect(201)
    ).body;
    expect(Number(created.grossTotal)).toBe(115);

    const updated = (
      await request(app.getHttpServer())
        .patch(`/ap/invoices/${created.id}`)
        .set(auth(ctx.accessToken))
        .send({
          lines: [{ description: "Corrected", quantity: "1", unitPrice: "200", vatCategory: "ZERO_RATED", accountId: account2.id }],
        })
        .expect(200)
    ).body;
    expect(Number(updated.netTotal)).toBe(200);
    expect(Number(updated.vatTotal)).toBe(0);
    expect(updated.lines).toHaveLength(1);
    expect(updated.lines[0].expenseAccountId).toBe(account2.id);
    expect(updated.lines[0].description).toBe("Corrected");
  });

  it("computes tax-inclusive VAT on edit, preserving the entered gross exactly", async () => {
    const ctx = await setupUserWithCompany(app);
    const vendor = await createPartner(app, ctx.accessToken, "VENDOR");
    const account = ctx.accountByCode("5240");

    const created = (
      await request(app.getHttpServer())
        .post("/ap/invoices")
        .set(auth(ctx.accessToken))
        .send({
          businessPartnerId: vendor.id,
          vendorInvoiceNumber: "INCL-001",
          postingDate: new Date().toISOString(),
          dueDate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
          lines: [{ description: "Placeholder", quantity: "1", unitPrice: "1", accountId: account.id }],
        })
        .expect(201)
    ).body;

    const updated = (
      await request(app.getHttpServer())
        .patch(`/ap/invoices/${created.id}`)
        .set(auth(ctx.accessToken))
        .send({
          lines: [{ description: "Inclusive amount", quantity: "1", unitPrice: "115", vatCategory: "STANDARD_15", taxMode: "INCLUSIVE", accountId: account.id }],
        })
        .expect(200)
    ).body;
    expect(Number(updated.grossTotal)).toBe(115);
    expect(Number(updated.netTotal)).toBe(100);
    expect(Number(updated.vatTotal)).toBe(15);
  });

  it("returns 409 when editing a posted invoice", async () => {
    const ctx = await setupUserWithCompany(app);
    const vendor = await createPartner(app, ctx.accessToken, "VENDOR");
    const account = ctx.accountByCode("5240");

    const created = (
      await request(app.getHttpServer())
        .post("/ap/invoices")
        .set(auth(ctx.accessToken))
        .send({
          businessPartnerId: vendor.id,
          vendorInvoiceNumber: "POSTED-001",
          postingDate: new Date().toISOString(),
          dueDate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
          lines: [{ description: "Line", quantity: "1", unitPrice: "50", accountId: account.id }],
        })
        .expect(201)
    ).body;

    await request(app.getHttpServer())
      .post(`/ap/invoices/${created.id}/post`)
      .set(auth(ctx.accessToken))
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/ap/invoices/${created.id}`)
      .set(auth(ctx.accessToken))
      .send({ lines: [{ description: "Nope", quantity: "1", unitPrice: "99", accountId: account.id }] })
      .expect(409);
  });

  it("project cost breakdown reflects posted purchase invoice costs and pending amount", async () => {
    const ctx = await setupUserWithCompany(app);
    const vendor = await createPartner(app, ctx.accessToken, "VENDOR");
    const account = ctx.accountByCode("5240");

    const project = (
      await request(app.getHttpServer())
        .post("/projects")
        .set(auth(ctx.accessToken))
        .send({ code: "COSTBD", name: "Cost Breakdown Test" })
        .expect(201)
    ).body;
    await request(app.getHttpServer())
      .post(`/projects/${project.id}/status`)
      .set(auth(ctx.accessToken))
      .send({ status: "ACTIVE" })
      .expect(201);

    const invoice = (
      await request(app.getHttpServer())
        .post("/ap/invoices")
        .set(auth(ctx.accessToken))
        .send({
          businessPartnerId: vendor.id,
          vendorInvoiceNumber: "PROJ-COST-001",
          postingDate: new Date().toISOString(),
          dueDate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
          lines: [{ description: "Materials", quantity: "1", unitPrice: "1000", vatCategory: "STANDARD_15", accountId: account.id, projectId: project.id }],
        })
        .expect(201)
    ).body;
    await request(app.getHttpServer())
      .post(`/ap/invoices/${invoice.id}/post`)
      .set(auth(ctx.accessToken))
      .expect(201);

    const breakdown = (
      await request(app.getHttpServer())
        .get(`/projects/${project.id}/cost-breakdown`)
        .set(auth(ctx.accessToken))
        .expect(200)
    ).body;
    expect(Number(breakdown.totalCosts)).toBe(1000);
    expect(Number(breakdown.pendingAmount)).toBe(1150); // gross open amount, unpaid
    expect(breakdown.byAccount.find((r: any) => r.code === account.code).amount).toBe("1000.00");
  });
});
