import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, createItem, createPartner, setupUserWithCompany } from "./utils/test-app";

describe("Finance reports (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupContext() {
    const ctx = await setupUserWithCompany(app);
    const customer = await createPartner(app, ctx.accessToken, "CUSTOMER");
    const vendor = await createPartner(app, ctx.accessToken, "VENDOR");
    const item = await createItem(app, ctx.accessToken, {
      defaultSalesAccountId: ctx.accountByCode("4100").id,
      defaultPurchaseAccountId: ctx.accountByCode("5240").id,
    });
    return { ...ctx, customer, vendor, item };
  }

  async function postArInvoice(
    ctx: Awaited<ReturnType<typeof setupContext>>,
    unitPrice: string,
    dueInDays: number,
    extra: Record<string, unknown> = {},
  ) {
    const today = new Date();
    const draft = await request(app.getHttpServer())
      .post("/ar/invoices")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        businessPartnerId: ctx.customer.id,
        issueDateTime: today.toISOString(),
        postingDate: today.toISOString(),
        dueDate: new Date(today.getTime() + dueInDays * 24 * 3600 * 1000).toISOString(),
        lines: [{ itemId: ctx.item.id, description: "Line", quantity: "1", unitPrice }],
        ...extra,
      })
      .expect(201);
    const posted = await request(app.getHttpServer())
      .post(`/ar/invoices/${draft.body.id}/post`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(201);
    return posted.body;
  }

  it("buckets AR aging by overdue days and excludes paid invoices", async () => {
    const ctx = await setupContext();

    // Overdue amounts land in buckets by (asOfDate - dueDate)
    await postArInvoice(ctx, "100", -10); // 1–30 days overdue, gross 115
    await postArInvoice(ctx, "200", -45); // 31–60, gross 230
    await postArInvoice(ctx, "300", -75); // 61–90, gross 345
    await postArInvoice(ctx, "400", -120); // 90+, gross 460
    await postArInvoice(ctx, "500", 15); // not yet due → current, gross 575

    // A paid invoice must not appear
    const paidInvoice = await postArInvoice(ctx, "50", -5); // gross 57.50
    await request(app.getHttpServer())
      .post("/payments/incoming")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        businessPartnerId: ctx.customer.id,
        paymentDate: new Date().toISOString(),
        bankCashAccountId: ctx.accountByCode("1120").id,
        amount: "57.5",
        allocations: [{ invoiceId: paidInvoice.id, amount: "57.5" }],
      })
      .expect(201);

    const report = (
      await request(app.getHttpServer())
        .get("/reports/ar-aging")
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200)
    ).body;

    expect(report.rows).toHaveLength(1);
    const row = report.rows[0];
    expect(Number(row.current)).toBe(575);
    expect(Number(row.days1to30)).toBe(115);
    expect(Number(row.days31to60)).toBe(230);
    expect(Number(row.days61to90)).toBe(345);
    expect(Number(row.days90plus)).toBe(460);
    expect(Number(row.total)).toBe(575 + 115 + 230 + 345 + 460);
  });

  it("computes the VAT return with credit notes reducing output VAT", async () => {
    const ctx = await setupContext();

    // Sales: 1000 standard (150 VAT) + 500 zero-rated (0 VAT)
    const invoice = await postArInvoice(ctx, "1000", 30);
    await postArInvoice(ctx, "500", 30, {
      lines: [{ itemId: ctx.item.id, description: "Export", quantity: "1", unitPrice: "500", vatCategory: "ZERO_RATED" }],
    });

    // Credit note 200 (30 VAT) against the first invoice
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
        lines: [{ itemId: ctx.item.id, description: "Refund", quantity: "1", unitPrice: "200" }],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/ar/invoices/${cnDraft.body.id}/post`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(201);

    // Purchase: 400 standard (60 input VAT)
    const apDraft = await request(app.getHttpServer())
      .post("/ap/invoices")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        businessPartnerId: ctx.vendor.id,
        vendorInvoiceNumber: `VND-${Date.now()}`,
        postingDate: new Date().toISOString(),
        dueDate: new Date().toISOString(),
        lines: [{ itemId: ctx.item.id, description: "Supplies", quantity: "1", unitPrice: "400" }],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/ap/invoices/${apDraft.body.id}/post`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(201);

    const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const to = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const report = (
      await request(app.getHttpServer())
        .get(`/reports/vat-return?fromDate=${from}&toDate=${to}`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200)
    ).body;

    // Output: 150 − 30 (CN) = 120; Input: 60; Net payable: 60
    expect(Number(report.outputVat)).toBe(120);
    expect(Number(report.inputVat)).toBe(60);
    expect(Number(report.netVatPayable)).toBe(60);

    const standardSales = report.salesByCategory.find((c: any) => c.vatCategory === "STANDARD_15");
    const zeroRatedSales = report.salesByCategory.find((c: any) => c.vatCategory === "ZERO_RATED");
    expect(Number(standardSales.netAmount)).toBe(800); // 1000 − 200 CN
    expect(Number(zeroRatedSales.netAmount)).toBe(500);
    expect(Number(zeroRatedSales.vatAmount)).toBe(0);
  });

  it("keeps the trial balance balanced after the full AR/AP/payment cycle", async () => {
    const ctx = await setupContext();

    const invoice = await postArInvoice(ctx, "1000", 30);
    await request(app.getHttpServer())
      .post("/payments/incoming")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        businessPartnerId: ctx.customer.id,
        paymentDate: new Date().toISOString(),
        bankCashAccountId: ctx.accountByCode("1120").id,
        amount: "1150",
        allocations: [{ invoiceId: invoice.id, amount: "1150" }],
      })
      .expect(201);

    const tb = (
      await request(app.getHttpServer())
        .get("/reports/trial-balance")
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200)
    ).body;
    expect(tb.totalDebit).toBe(tb.totalCredit);

    // Bank 1150 Dr, AR net zero, revenue 1000 Cr, VAT 150 Cr
    const rowByCode = (code: string) => tb.rows.find((r: any) => r.accountCode === code);
    expect(Number(rowByCode("1120").closingBalance)).toBe(1150);
    expect(Number(rowByCode("1210").closingBalance)).toBe(0);
    expect(Number(rowByCode("4100").closingBalance)).toBe(-1000);
    expect(Number(rowByCode("2200").closingBalance)).toBe(-150);
  });

  async function postJournalEntry(
    ctx: Awaited<ReturnType<typeof setupContext>>,
    lines: Array<{ accountCode: string; debit: string; credit: string }>,
    postingDate: Date = new Date(),
  ) {
    const draft = await request(app.getHttpServer())
      .post("/gl/journal-entries")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        postingDate: postingDate.toISOString(),
        documentDate: postingDate.toISOString(),
        lines: lines.map((l) => ({ accountId: ctx.accountByCode(l.accountCode).id, debit: l.debit, credit: l.credit })),
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/gl/journal-entries/${draft.body.id}/post`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(201);
  }

  it("computes IFRS 18 Statement of Profit or Loss subtotals and the EBITDA reconciliation", async () => {
    const ctx = await setupContext();

    // Operating: revenue 1000 (AR invoice, ex-VAT) − COGS 300 − opex 200 = Operating Profit 500
    await postArInvoice(ctx, "1000", 30);
    await postJournalEntry(ctx, [
      { accountCode: "5100", debit: "300", credit: "0" },
      { accountCode: "1310", debit: "0", credit: "300" },
    ]);
    await postJournalEntry(ctx, [
      { accountCode: "5240", debit: "200", credit: "0" },
      { accountCode: "1120", debit: "0", credit: "200" },
    ]);
    // Depreciation 50 (part of opex, also feeds EBITDA reconciliation)
    await postJournalEntry(ctx, [
      { accountCode: "5230", debit: "50", credit: "0" },
      { accountCode: "1120", debit: "0", credit: "50" },
    ]);
    // Investing income 80 (gain on asset disposal)
    await postJournalEntry(ctx, [
      { accountCode: "1120", debit: "80", credit: "0" },
      { accountCode: "4950", debit: "0", credit: "80" },
    ]);
    // Finance costs 40, tax expense 60
    await postJournalEntry(ctx, [
      { accountCode: "5800", debit: "40", credit: "0" },
      { accountCode: "1120", debit: "0", credit: "40" },
    ]);
    await postJournalEntry(ctx, [
      { accountCode: "5900", debit: "60", credit: "0" },
      { accountCode: "1120", debit: "0", credit: "60" },
    ]);

    const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const to = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const report = (
      await request(app.getHttpServer())
        .get(`/reports/profit-or-loss?fromDate=${from}&toDate=${to}`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200)
    ).body;

    expect(Number(report.operatingRevenue)).toBe(1000);
    expect(Number(report.costOfSales)).toBe(300);
    expect(Number(report.operatingExpense)).toBe(200 + 50);
    expect(Number(report.operatingProfit)).toBe(1000 - 300 - 250); // 450
    expect(Number(report.investingIncome)).toBe(80);
    expect(Number(report.profitBeforeFinancingAndTax)).toBe(450 + 80); // 530
    expect(Number(report.financeCosts)).toBe(40);
    expect(Number(report.taxExpense)).toBe(60);
    expect(Number(report.profitForThePeriod)).toBe(530 - 40 - 60); // 430

    const ebitda = report.managementPerformanceMeasures.find((m: any) => m.name === "EBITDA");
    expect(ebitda).toBeDefined();
    expect(Number(ebitda.value)).toBe(450 + 50); // Operating Profit + Depreciation = 500
    const opLine = ebitda.reconciliation.find((l: any) => l.label === "Operating Profit");
    const deprLine = ebitda.reconciliation.find((l: any) => l.label === "Depreciation Expense");
    expect(Number(opLine.amount)).toBe(450);
    expect(Number(deprLine.amount)).toBe(50);
  });

  it("drills a P&L line down to its constituent accounts and each account down to its transactions", async () => {
    const ctx = await setupContext();

    await postArInvoice(ctx, "1000", 30);
    await postJournalEntry(ctx, [
      { accountCode: "5240", debit: "200", credit: "0" },
      { accountCode: "1120", debit: "0", credit: "200" },
    ]);
    await postJournalEntry(ctx, [
      { accountCode: "5230", debit: "50", credit: "0" },
      { accountCode: "1120", debit: "0", credit: "50" },
    ]);

    const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const to = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

    const report = (
      await request(app.getHttpServer())
        .get(`/reports/profit-or-loss?fromDate=${from}&toDate=${to}`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200)
    ).body;
    expect(Number(report.operatingExpense)).toBe(250);

    const detail = (
      await request(app.getHttpServer())
        .get(`/reports/profit-or-loss/line-detail?line=operatingExpense&fromDate=${from}&toDate=${to}`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200)
    ).body;
    // The breakdown must reconcile exactly with the top-line P&L figure.
    expect(Number(detail.total)).toBe(Number(report.operatingExpense));
    const officeAdmin = detail.accounts.find((a: any) => a.code === "5240");
    const depreciation = detail.accounts.find((a: any) => a.code === "5230");
    expect(Number(officeAdmin.amount)).toBe(200);
    expect(Number(depreciation.amount)).toBe(50);

    const officeAdminAccountId = ctx.accountByCode("5240").id;
    const transactions = (
      await request(app.getHttpServer())
        .get(`/reports/accounts/${officeAdminAccountId}/transactions?fromDate=${from}&toDate=${to}`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200)
    ).body;
    expect(Number(transactions.totalDebit)).toBe(200);
    expect(transactions.transactions).toHaveLength(1);
    expect(Number(transactions.transactions[0].debit)).toBe(200);

    // Rejects an unrecognized line key rather than silently returning nothing.
    await request(app.getHttpServer())
      .get(`/reports/profit-or-loss/line-detail?line=notARealLine&fromDate=${from}&toDate=${to}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(400);
  });

  it("balances the Statement of Financial Position (Assets = Liabilities + Equity)", async () => {
    const ctx = await setupContext();

    await postArInvoice(ctx, "1000", 30);
    await postJournalEntry(ctx, [
      { accountCode: "5240", debit: "150", credit: "0" },
      { accountCode: "1120", debit: "0", credit: "150" },
    ]);

    const report = (
      await request(app.getHttpServer())
        .get("/reports/financial-position")
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200)
    ).body;

    expect(report.isBalanced).toBe(true);
    const diff = Number(report.totalAssets) - (Number(report.totalLiabilities) + Number(report.totalEquity));
    expect(Math.abs(diff)).toBeLessThan(0.01);

    const currentYearEarnings = report.equity.find((l: any) => l.subClassCode === "CURRENT_YEAR_EARNINGS");
    expect(currentYearEarnings).toBeDefined();
    // Revenue 1000 (AR ex-VAT) − expense 150 = 850 current-year earnings
    expect(Number(currentYearEarnings.balance)).toBe(850);
  });

  it("drills a Balance Sheet line, and a Trial Balance row, down to their transactions", async () => {
    const ctx = await setupContext();
    await postArInvoice(ctx, "1000", 30);

    const asOfDate = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

    const bsReport = (
      await request(app.getHttpServer())
        .get(`/reports/financial-position?asOfDate=${asOfDate}`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200)
    ).body;
    const currentAssetsLine = bsReport.currentAssets.find((l: any) => l.subClassCode === "CURRENT_ASSET");
    expect(currentAssetsLine).toBeDefined();

    const bsDetail = (
      await request(app.getHttpServer())
        .get(`/reports/financial-position/line-detail?subClassCode=${currentAssetsLine.subClassCode}&asOfDate=${asOfDate}`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200)
    ).body;
    expect(Number(bsDetail.total)).toBe(Number(currentAssetsLine.balance));

    const arAccount = bsDetail.accounts[0];
    const arTransactions = (
      await request(app.getHttpServer())
        .get(`/reports/accounts/${arAccount.accountId}/transactions?asOfDate=${asOfDate}`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200)
    ).body;
    expect(Number(arTransactions.totalDebit) - Number(arTransactions.totalCredit)).toBe(Number(arAccount.amount));

    // Trial Balance row -> transactions drill-down goes straight to the
    // account (already granular), skipping the sub-class breakdown step.
    const trialBalance = (
      await request(app.getHttpServer())
        .get(`/reports/trial-balance?asOfDate=${asOfDate}`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200)
    ).body;
    const tbRow = trialBalance.rows.find((r: any) => r.accountId === arAccount.accountId);
    expect(tbRow).toBeDefined();
    expect(Number(tbRow.closingBalance)).toBe(Number(arTransactions.totalDebit) - Number(arTransactions.totalCredit));
  });

  // Regression test for a real bug: financialPosition()'s raw SQL used an
  // unconditional LEFT JOIN into journal_entry_lines followed by a second
  // LEFT JOIN into journal_entries carrying the "postingDate <= asOfDate"
  // filter in its ON clause — a join miss only nulls out je's own columns,
  // it does NOT filter jel, so SUM(jel.debit)/SUM(jel.credit) silently
  // summed ALL-TIME activity regardless of asOfDate. Fixed by gating the
  // SUM on `je."id" IS NOT NULL`. This test posts activity strictly AFTER
  // asOfDate and asserts it's excluded.
  it("excludes postings made after asOfDate from the Statement of Financial Position", async () => {
    const ctx = await setupContext();
    const future = new Date(Date.now() + 10 * 24 * 3600 * 1000);
    await postJournalEntry(
      ctx,
      [
        { accountCode: "1120", debit: "9999", credit: "0" },
        { accountCode: "3100", debit: "0", credit: "9999" },
      ],
      future,
    );

    const before = (
      await request(app.getHttpServer())
        .get("/reports/financial-position")
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200)
    ).body;

    expect(Number(before.totalAssets)).toBe(0);
    expect(Number(before.totalEquity)).toBe(0);
    expect(before.isBalanced).toBe(true);
  });

  it("computes the Statement of Changes in Equity — opening, profit roll-forward, and direct movements", async () => {
    const ctx = await setupContext();
    const periodStart = new Date("2026-03-01T00:00:00.000Z");
    const periodEnd = new Date("2026-03-31T00:00:00.000Z");
    const beforePeriod = new Date("2026-02-15T00:00:00.000Z");

    // Opening balance: capital raised before the period.
    await postJournalEntry(
      ctx,
      [
        { accountCode: "1120", debit: "2000", credit: "0" },
        { accountCode: "3100", debit: "0", credit: "2000" },
      ],
      beforePeriod,
    );
    // Exactly at fromDate — must land in the opening balance, not "other movements".
    await postJournalEntry(
      ctx,
      [
        { accountCode: "1120", debit: "500", credit: "0" },
        { accountCode: "3100", debit: "0", credit: "500" },
      ],
      new Date("2026-02-28T00:00:00.000Z"),
    );
    // Revenue 1000 within the period → flows into Retained Earnings via profitForPeriod.
    await postJournalEntry(
      ctx,
      [
        { accountCode: "1120", debit: "1000", credit: "0" },
        { accountCode: "4100", debit: "0", credit: "1000" },
      ],
      periodStart,
    );
    // A within-period capital injection → "other movements" for Share Capital.
    await postJournalEntry(
      ctx,
      [
        { accountCode: "1120", debit: "300", credit: "0" },
        { accountCode: "3100", debit: "0", credit: "300" },
      ],
      new Date("2026-03-15T00:00:00.000Z"),
    );

    const report = (
      await request(app.getHttpServer())
        .get(`/reports/changes-in-equity?fromDate=${periodStart.toISOString()}&toDate=${periodEnd.toISOString()}`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200)
    ).body;

    const shareCapital = report.lines.find((l: any) => l.subClassCode === "SHARE_CAPITAL");
    expect(Number(shareCapital.opening)).toBe(2500); // 2000 + 500 (posted before fromDate, inclusive of Feb 28)
    expect(Number(shareCapital.otherMovements)).toBe(300);
    expect(Number(shareCapital.closing)).toBe(2800);

    const retainedEarnings = report.lines.find((l: any) => l.subClassCode === "RETAINED_EARNINGS");
    expect(Number(retainedEarnings.opening)).toBe(0);
    expect(Number(retainedEarnings.profitForPeriod)).toBe(1000);
    expect(Number(retainedEarnings.closing)).toBe(1000);

    expect(Number(report.totalClosing)).toBe(2800 + 1000);
  });

  it("computes the Statement of Cash Flows (indirect method) and reconciles to actual cash movement", async () => {
    const ctx = await setupContext();
    const from = new Date("2026-06-01T00:00:00.000Z");
    const to = new Date("2026-06-30T00:00:00.000Z");

    // Financing: capital injection 5000.
    await postJournalEntry(ctx, [
      { accountCode: "1120", debit: "5000", credit: "0" },
      { accountCode: "3100", debit: "0", credit: "5000" },
    ], from);
    // Operating: sale on credit 1000 (increases AR — cash-flow negative).
    await postJournalEntry(ctx, [
      { accountCode: "1210", debit: "1000", credit: "0" },
      { accountCode: "4100", debit: "0", credit: "1000" },
    ], new Date("2026-06-05T00:00:00.000Z"));
    // Operating: expense on credit 400 (increases AP — cash-flow positive).
    await postJournalEntry(ctx, [
      { accountCode: "5240", debit: "400", credit: "0" },
      { accountCode: "2110", debit: "0", credit: "400" },
    ], new Date("2026-06-06T00:00:00.000Z"));
    // Operating: depreciation 100 (non-cash addback).
    await postJournalEntry(ctx, [
      { accountCode: "5230", debit: "100", credit: "0" },
      { accountCode: "1519", debit: "0", credit: "100" },
    ], new Date("2026-06-10T00:00:00.000Z"));
    // Financing: interest paid 50 (cash outflow; must not be double-subtracted from operating).
    await postJournalEntry(ctx, [
      { accountCode: "5800", debit: "50", credit: "0" },
      { accountCode: "1120", debit: "0", credit: "50" },
    ], new Date("2026-06-15T00:00:00.000Z"));

    const report = (
      await request(app.getHttpServer())
        .get(`/reports/cash-flow?fromDate=${from.toISOString()}&toDate=${to.toISOString()}`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200)
    ).body;

    // Profit for period: revenue 1000 − opex 400 − depreciation 100 − finance cost 50 = 450.
    expect(Number(report.profitForPeriod)).toBe(450);
    expect(Number(report.depreciation)).toBe(100);
    expect(Number(report.financeCostsAddback)).toBe(50);
    const ar = report.workingCapitalItems.find((i: any) => i.label.includes("receivables"));
    const ap = report.workingCapitalItems.find((i: any) => i.label.includes("payables"));
    expect(Number(ar.amount)).toBe(-1000);
    expect(Number(ap.amount)).toBe(400);
    // 450 + 100 (depreciation) + 50 (finance cost addback) − 1000 (AR) + 400 (AP) = 0
    expect(Number(report.netCashFromOperating)).toBe(0);

    const financeCostsLine = report.financingItems.find((i: any) => i.label.includes("Finance costs"));
    const shareCapitalLine = report.financingItems.find((i: any) => i.label.includes("share capital"));
    expect(Number(financeCostsLine.amount)).toBe(-50);
    expect(Number(shareCapitalLine.amount)).toBe(5000);
    expect(Number(report.netCashFromFinancing)).toBe(4950);

    expect(Number(report.netChangeInCash)).toBe(0 + 4950); // no investing activity this period
    expect(Number(report.openingCash)).toBe(0);
    expect(Number(report.closingCash)).toBe(4950);
    expect(report.isReconciled).toBe(true);

    // Drill down: two of the top-line figures above, verified against their
    // per-account breakdown, then down to the transaction that caused them.
    const arDetail = (
      await request(app.getHttpServer())
        .get(`/reports/cash-flow/line-detail?line=wcTradeReceivables&fromDate=${from.toISOString()}&toDate=${to.toISOString()}`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200)
    ).body;
    expect(Number(arDetail.total)).toBe(Number(ar.amount));
    expect(arDetail.accounts).toHaveLength(1);

    const shareCapitalDetail = (
      await request(app.getHttpServer())
        .get(`/reports/cash-flow/line-detail?line=financingShareCapital&fromDate=${from.toISOString()}&toDate=${to.toISOString()}`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200)
    ).body;
    expect(Number(shareCapitalDetail.total)).toBe(5000);
    const shareCapitalAccount = shareCapitalDetail.accounts[0];
    const shareCapitalTransactions = (
      await request(app.getHttpServer())
        .get(`/reports/accounts/${shareCapitalAccount.accountId}/transactions?fromDate=${from.toISOString()}&toDate=${to.toISOString()}`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200)
    ).body;
    expect(Number(shareCapitalTransactions.totalCredit)).toBe(5000);
    expect(shareCapitalTransactions.transactions[0].status).toBe("POSTED");
  });

  it("drills a Changes in Equity line down to accounts, reconciling opening and other-movements columns", async () => {
    const ctx = await setupContext();
    const from = new Date("2026-06-01T00:00:00.000Z");
    const to = new Date("2026-06-30T00:00:00.000Z");

    // Prior-period capital (opening balance for the June statement).
    await postJournalEntry(
      ctx,
      [
        { accountCode: "1120", debit: "2000", credit: "0" },
        { accountCode: "3100", debit: "0", credit: "2000" },
      ],
      new Date("2026-05-01T00:00:00.000Z"),
    );
    // In-period capital injection (an "other movement" for June).
    await postJournalEntry(
      ctx,
      [
        { accountCode: "1120", debit: "500", credit: "0" },
        { accountCode: "3100", debit: "0", credit: "500" },
      ],
      new Date("2026-06-10T00:00:00.000Z"),
    );

    const report = (
      await request(app.getHttpServer())
        .get(`/reports/changes-in-equity?fromDate=${from.toISOString()}&toDate=${to.toISOString()}`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200)
    ).body;
    const shareCapitalLine = report.lines.find((l: any) => l.subClassCode === "SHARE_CAPITAL");
    expect(Number(shareCapitalLine.opening)).toBe(2000);
    expect(Number(shareCapitalLine.otherMovements)).toBe(500);

    const openingDetail = (
      await request(app.getHttpServer())
        .get(
          `/reports/changes-in-equity/line-detail?subClassCode=SHARE_CAPITAL&column=opening&fromDate=${from.toISOString()}&toDate=${to.toISOString()}`,
        )
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200)
    ).body;
    expect(Number(openingDetail.total)).toBe(2000);

    const movementsDetail = (
      await request(app.getHttpServer())
        .get(
          `/reports/changes-in-equity/line-detail?subClassCode=SHARE_CAPITAL&column=otherMovements&fromDate=${from.toISOString()}&toDate=${to.toISOString()}`,
        )
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200)
    ).body;
    expect(Number(movementsDetail.total)).toBe(500);
  });

  it("lets an Administrator reverse a posted entry from the account-transactions drill-down", async () => {
    const ctx = await setupContext();
    await postJournalEntry(ctx, [
      { accountCode: "5240", debit: "300", credit: "0" },
      { accountCode: "1120", debit: "0", credit: "300" },
    ]);

    const officeAdminAccountId = ctx.accountByCode("5240").id;
    const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const to = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

    const before = (
      await request(app.getHttpServer())
        .get(`/reports/accounts/${officeAdminAccountId}/transactions?fromDate=${from}&toDate=${to}`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200)
    ).body;
    expect(before.transactions[0].status).toBe("POSTED");

    await request(app.getHttpServer())
      .post(`/gl/journal-entries/${before.transactions[0].journalEntryId}/reverse`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(201);

    const after = (
      await request(app.getHttpServer())
        .get(`/reports/accounts/${officeAdminAccountId}/transactions?fromDate=${from}&toDate=${to}`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200)
    ).body;
    const original = after.transactions.find((t: any) => t.journalEntryId === before.transactions[0].journalEntryId);
    expect(original.status).toBe("REVERSED");
  });

  it("isolates reports between companies and blocks viewers from writing", async () => {
    const a = await setupContext();
    await postArInvoice(a, "1000", -10);

    const b = await setupUserWithCompany(app);
    const reportB = (
      await request(app.getHttpServer())
        .get("/reports/ar-aging")
        .set("Authorization", `Bearer ${b.accessToken}`)
        .expect(200)
    ).body;
    expect(reportB.rows).toHaveLength(0);
  });
});
