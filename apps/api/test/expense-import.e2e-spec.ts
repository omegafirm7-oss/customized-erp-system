import { INestApplication } from "@nestjs/common";
import request from "supertest";
import * as XLSX from "xlsx";
import { createTestApp, createPartner, setupUserWithCompany } from "./utils/test-app";

const EXPENSE_HEADER = [
  "vendorCode",
  "vendorInvoiceNumber",
  "postingDate",
  "dueDate",
  "description",
  "amount",
  "expenseAccountCode",
  "costCenterCode",
  "vatCategory",
];

function buildXlsx(rows: string[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([EXPENSE_HEADER, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Expenses");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("AP expense import from Excel (e2e)", () => {
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

  it("downloads a real, parseable xlsx template with the correct headers", async () => {
    // Regression test for a real bug: the controller originally returned a
    // raw Buffer from a normal handler, which Nest JSON-serializes into
    // `{"type":"Buffer","data":[...]}` instead of sending binary content —
    // the "template" was actually corrupt JSON, not a real spreadsheet.
    // Fixed via StreamableFile. `.buffer(true).parse(...)` is required here
    // because supertest doesn't buffer binary responses by default.
    const { accessToken } = await setupUserWithCompany(app);
    const res = await request(app.getHttpServer())
      .get("/ap/invoices/import/expenses/template")
      .set(auth(accessToken))
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
    expect(res.headers["content-disposition"]).toContain("expenses_import_template.xlsx");

    const body = res.body as Buffer;
    expect(body.subarray(0, 2).toString()).toBe("PK"); // zip/xlsx magic bytes
    const workbook = XLSX.read(body, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
    expect(rows[0]).toEqual(EXPENSE_HEADER);
  });

  it("imports valid expense rows as DRAFT purchase invoices with computed VAT", async () => {
    const ctx = await setupUserWithCompany(app);
    const vendor = await createPartner(app, ctx.accessToken, "VENDOR");
    const expenseAccount = ctx.accountByCode("5240");

    const xlsx = buildXlsx([
      [vendor.code, "UTIL-001", "2026-07-01", "2026-07-31", "July electricity", "1000.00", expenseAccount.code, "", "STANDARD_15"],
      [vendor.code, "UTIL-002", "2026-07-01", "2026-07-31", "July water", "200.00", expenseAccount.code, "", "ZERO_RATED"],
    ]);

    const res = await request(app.getHttpServer())
      .post("/ap/invoices/import/expenses")
      .set(auth(ctx.accessToken))
      .attach("file", xlsx, "expenses.xlsx")
      .expect(201);
    expect(res.body.imported).toBe(2);
    expect(res.body.errors).toHaveLength(0);

    const invoices = (
      await request(app.getHttpServer()).get("/ap/invoices").set(auth(ctx.accessToken)).expect(200)
    ).body;
    expect(invoices).toHaveLength(2);
    const utilInvoice = invoices.find((i: any) => i.vendorInvoiceNumber === "UTIL-001");
    expect(utilInvoice.status).toBe("DRAFT");
    expect(Number(utilInvoice.netTotal)).toBe(1000);
    expect(Number(utilInvoice.vatTotal)).toBe(150); // 15%
    const waterInvoice = invoices.find((i: any) => i.vendorInvoiceNumber === "UTIL-002");
    expect(Number(waterInvoice.vatTotal)).toBe(0); // zero-rated
  });

  it("rejects the whole file (all-or-nothing) on an unknown vendor or account code", async () => {
    const ctx = await setupUserWithCompany(app);

    const xlsx = buildXlsx([
      ["NOPE-VENDOR", "X-001", "2026-07-01", "2026-07-31", "Bad row", "100", "5240", "", ""],
    ]);
    const res = await request(app.getHttpServer())
      .post("/ap/invoices/import/expenses")
      .set(auth(ctx.accessToken))
      .attach("file", xlsx, "expenses.xlsx")
      .expect(201);
    expect(res.body.imported).toBe(0);
    expect(res.body.errors.length).toBeGreaterThan(0);
    expect(res.body.errors[0].message).toMatch(/Vendor code/);

    const invoices = (
      await request(app.getHttpServer()).get("/ap/invoices").set(auth(ctx.accessToken)).expect(200)
    ).body;
    expect(invoices).toHaveLength(0);
  });

  it("rejects a vendor invoice number that's already booked", async () => {
    const ctx = await setupUserWithCompany(app);
    const vendor = await createPartner(app, ctx.accessToken, "VENDOR");
    const expenseAccount = ctx.accountByCode("5240");

    await request(app.getHttpServer())
      .post("/ap/invoices")
      .set(auth(ctx.accessToken))
      .send({
        businessPartnerId: vendor.id,
        vendorInvoiceNumber: "DUP-001",
        postingDate: new Date().toISOString(),
        dueDate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        lines: [{ description: "Existing", quantity: "1", unitPrice: "50", accountId: expenseAccount.id }],
      })
      .expect(201);

    const xlsx = buildXlsx([
      [vendor.code, "DUP-001", "2026-07-01", "2026-07-31", "Duplicate", "50", expenseAccount.code, "", ""],
    ]);
    const res = await request(app.getHttpServer())
      .post("/ap/invoices/import/expenses")
      .set(auth(ctx.accessToken))
      .attach("file", xlsx, "expenses.xlsx")
      .expect(201);
    expect(res.body.imported).toBe(0);
    expect(res.body.errors[0].message).toMatch(/already booked/);
  });

  it("rejects a file with the wrong column headers", async () => {
    const ctx = await setupUserWithCompany(app);
    const sheet = XLSX.utils.aoa_to_sheet([["wrong", "columns"], ["a", "b"]]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
    const badXlsx = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

    await request(app.getHttpServer())
      .post("/ap/invoices/import/expenses")
      .set(auth(ctx.accessToken))
      .attach("file", badXlsx, "bad.xlsx")
      .expect(400);
  });
});
