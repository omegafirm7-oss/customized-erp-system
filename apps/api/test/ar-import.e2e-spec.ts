import { INestApplication } from "@nestjs/common";
import request from "supertest";
import * as XLSX from "xlsx";
import { createPartner, createTestApp, getPrisma, setupUserWithCompany } from "./utils/test-app";

const COLUMNS = [
  "customerCode",
  "invoiceNumber",
  "issueDate",
  "dueDate",
  "description",
  "amount",
  "amountType",
  "vatCategory",
  "revenueAccountCode",
  "costCenterCode",
];

function workbook(rows: string[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([COLUMNS, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Sales invoices");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("Sales invoice Excel import (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const upload = (token: string, buffer: Buffer, post = false) =>
    request(app.getHttpServer())
      .post(`/ar/invoices/import${post ? "?post=true" : ""}`)
      .set("Authorization", `Bearer ${token}`)
      .attach("file", buffer, "sales.xlsx");

  const vatReturn = async (token: string) =>
    (
      await request(app.getHttpServer())
        .get(`/reports/vat-return?fromDate=2026-01-01T00:00:00.000Z&toDate=2026-12-31T23:59:59.000Z`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200)
    ).body;

  it("imports as drafts, groups rows into one invoice, and keeps them out of the VAT return until posted", async () => {
    const ctx = await setupUserWithCompany(app);
    const customer = await createPartner(app, ctx.accessToken, "CUSTOMER");

    const res = await upload(
      ctx.accessToken,
      workbook([
        [customer.code, "EXT-1", "2026-10-10", "2026-11-10", "Scaffolding", "1000", "NET", "STANDARD_15", "4200", ""],
        [customer.code, "EXT-1", "2026-10-10", "2026-11-10", "Delivery", "200", "NET", "STANDARD_15", "4200", ""],
        [customer.code, "EXT-2", "2026-10-12", "", "Export works", "500", "NET", "ZERO_RATED", "4200", ""],
      ]),
    ).expect(201);
    expect(res.body).toMatchObject({ imported: 2, posted: 0, errors: [] });

    const invoices = (await request(app.getHttpServer()).get("/ar/invoices").set("Authorization", `Bearer ${ctx.accessToken}`).expect(200)).body;
    expect(invoices).toHaveLength(2);
    expect(invoices.every((i: any) => i.status === "DRAFT")).toBe(true);
    const ext1 = invoices.find((i: any) => i.memo.startsWith("[EXT:EXT-1]"));
    expect(Number(ext1.netTotal)).toBe(1200);
    expect(Number(ext1.vatTotal)).toBe(180);

    expect(Number((await vatReturn(ctx.accessToken)).outputVat)).toBe(0);
  });

  it("posts immediately when asked, so the VAT return shows the output VAT by category", async () => {
    const ctx = await setupUserWithCompany(app);
    const customer = await createPartner(app, ctx.accessToken, "CUSTOMER");

    const res = await upload(
      ctx.accessToken,
      workbook([
        [customer.code, "P-1", "2026-10-10", "2026-11-10", "Standard sale", "1000", "NET", "STANDARD_15", "4200", ""],
        [customer.code, "P-2", "2026-10-11", "2026-11-11", "VAT-inclusive sale", "1150", "GROSS", "STANDARD_15", "4200", ""],
        [customer.code, "P-3", "2026-10-12", "2026-11-12", "Export", "500", "NET", "ZERO_RATED", "4200", ""],
      ]),
      true,
    ).expect(201);
    expect(res.body).toMatchObject({ imported: 3, posted: 3 });

    const report = await vatReturn(ctx.accessToken);
    expect(Number(report.outputVat)).toBe(300); // 150 + 150
    const standard = report.salesByCategory.find((c: any) => c.vatCategory === "STANDARD_15");
    expect(Number(standard.netAmount)).toBe(2000);
    const zero = report.salesByCategory.find((c: any) => c.vatCategory === "ZERO_RATED");
    expect(Number(zero.netAmount)).toBe(500);
  });

  it("rejects the whole file with row numbers on bad data, and blocks re-importing the same invoice", async () => {
    const ctx = await setupUserWithCompany(app);
    const customer = await createPartner(app, ctx.accessToken, "CUSTOMER");

    const bad = await upload(
      ctx.accessToken,
      workbook([
        [customer.code, "OK-1", "2026-10-10", "2026-11-10", "Fine row", "100", "NET", "", "4200", ""],
        ["NO-SUCH", "BAD-1", "2026-10-10", "2026-11-10", "Unknown customer", "100", "NET", "", "4200", ""],
        [customer.code, "BAD-2", "not-a-date", "", "Bad date", "-5", "NET", "", "9999", ""],
      ]),
    ).expect(201);
    expect(bad.body.imported).toBe(0);
    const messages = bad.body.errors.map((e: any) => `${e.row}:${e.message}`).join(" | ");
    expect(messages).toContain('3:Customer code "NO-SUCH" not found');
    expect(messages).toContain("4:issueDate must be a valid date");
    expect(messages).toContain("4:amount must be a positive number");
    expect(messages).toContain('4:Revenue account code "9999" not found');
    expect(await getPrisma(app).salesInvoice.count({ where: { companyId: ctx.companyId } })).toBe(0);

    const rows = [[customer.code, "DUP-1", "2026-10-10", "2026-11-10", "Once only", "100", "NET", "", "4200", ""]];
    await upload(ctx.accessToken, workbook(rows)).expect(201);
    const again = await upload(ctx.accessToken, workbook(rows)).expect(201);
    expect(again.body.imported).toBe(0);
    expect(again.body.errors[0].message).toContain("already imported");
  });

  it("refuses to post on import while ZATCA e-invoicing is active, but still allows drafts", async () => {
    const ctx = await setupUserWithCompany(app);
    const customer = await createPartner(app, ctx.accessToken, "CUSTOMER");
    const user = await getPrisma(app).companyUser.findFirstOrThrow({ where: { companyId: ctx.companyId } });
    await getPrisma(app).zatcaDevice.create({
      data: {
        companyId: ctx.companyId,
        environment: "SANDBOX",
        unitName: "Test EGS",
        egsSerialNumber: "1-Test|2-Test|3-Test",
        privateKeyEnc: "x",
        csrPem: "x",
        status: "ACTIVE",
        createdByUserId: user.userId,
      },
    });

    const rows = [[customer.code, "Z-1", "2026-10-10", "2026-11-10", "Sale", "100", "NET", "", "4200", ""]];
    await upload(ctx.accessToken, workbook(rows), true).expect(409);
    const draft = await upload(ctx.accessToken, workbook(rows)).expect(201);
    expect(draft.body.imported).toBe(1);
  });
});
