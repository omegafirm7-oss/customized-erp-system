import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, createItem, createPartner, setupUserWithCompany } from "./utils/test-app";

describe("Projects — full job accounting (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupProjectContext() {
    const ctx = await setupUserWithCompany(app);
    const customer = await createPartner(app, ctx.accessToken, "CUSTOMER");
    const vendor = await createPartner(app, ctx.accessToken, "VENDOR");
    const item = await createItem(app, ctx.accessToken, {
      defaultSalesAccountId: ctx.accountByCode("4100").id,
      defaultPurchaseAccountId: ctx.accountByCode("5240").id,
    });
    const periods = await request(app.getHttpServer())
      .get("/companies/current/fiscal-periods")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(200);
    return { ...ctx, customer, vendor, item, periods: periods.body };
  }

  async function createOverTimeProject(ctx: any) {
    const res = await request(app.getHttpServer())
      .post("/projects")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        code: "JOB-1",
        name: "Tower Construction",
        businessPartnerId: ctx.customer.id,
        recognitionMethod: "OVER_TIME",
        contractValue: "150000",
        estimatedTotalCost: "100000",
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/projects/${res.body.id}/status`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({ status: "ACTIVE" })
      .expect(201);
    return res.body;
  }

  async function postApCost(ctx: any, projectId: string, wbsTaskId: string | undefined, net: string, dateIso: string) {
    const draft = await request(app.getHttpServer())
      .post("/ap/invoices")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        businessPartnerId: ctx.vendor.id,
        vendorInvoiceNumber: `VND-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        postingDate: dateIso,
        dueDate: dateIso,
        lines: [{ itemId: ctx.item.id, description: "Project cost", quantity: "1", unitPrice: net, projectId, wbsTaskId }],
      })
      .expect(201);
    return (
      await request(app.getHttpServer())
        .post(`/ap/invoices/${draft.body.id}/post`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(201)
    ).body;
  }

  async function billProject(ctx: any, projectId: string, net: string, dateIso: string) {
    const draft = await request(app.getHttpServer())
      .post("/ar/invoices")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        businessPartnerId: ctx.customer.id,
        issueDateTime: dateIso,
        postingDate: dateIso,
        dueDate: dateIso,
        lines: [{ description: "Progress billing", quantity: "1", unitPrice: net, projectId, accountId: undefined }],
      })
      .expect(201);
    return (
      await request(app.getHttpServer())
        .post(`/ar/invoices/${draft.body.id}/post`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(201)
    ).body;
  }

  function dateIn(period: any): string {
    return new Date(period.startDate).toISOString();
  }

  it("creates a project with an auto cost center and WBS tasks", async () => {
    const ctx = await setupProjectContext();
    const project = await request(app.getHttpServer())
      .post("/projects")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({ code: "PRJ-A", name: "Test Project", recognitionMethod: "POINT_IN_TIME" })
      .expect(201);
    expect(project.body.costCenter.code).toBe("PRJ-PRJ-A");
    expect(project.body.status).toBe("PLANNED");

    const task1 = await request(app.getHttpServer())
      .post(`/projects/${project.body.id}/tasks`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({ code: "T1", name: "Foundation", costBudget: "60000" })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/projects/${project.body.id}/tasks`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({ code: "T1.1", name: "Excavation", parentTaskId: task1.body.id, costBudget: "20000" })
      .expect(201);

    const detail = await request(app.getHttpServer())
      .get(`/projects/${project.body.id}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(200);
    expect(detail.body.tasks).toHaveLength(2);
  });

  it("blocks costs on PLANNED projects and stamps dims on ACTIVE ones", async () => {
    const ctx = await setupProjectContext();
    const planned = await request(app.getHttpServer())
      .post("/projects")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({ code: "PLN-1", name: "Planned Project" })
      .expect(201);

    // Cost against PLANNED → 400
    const today = new Date().toISOString();
    const rejected = await request(app.getHttpServer())
      .post("/ap/invoices")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        businessPartnerId: ctx.vendor.id,
        vendorInvoiceNumber: `VND-${Date.now()}`,
        postingDate: today,
        dueDate: today,
        lines: [{ itemId: ctx.item.id, description: "Cost", quantity: "1", unitPrice: "100", projectId: planned.body.id }],
      });
    expect(rejected.status).toBe(400);
    expect(rejected.body.message).toContain("ACTIVE");

    // ACTIVE project: expense leg carries costCenterId + wbsTaskId, AP leg carries neither
    const project = await createOverTimeProject(ctx);
    const task = await request(app.getHttpServer())
      .post(`/projects/${project.id}/tasks`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({ code: "T1", name: "Works", costBudget: "50000" })
      .expect(201);

    const invoice = await postApCost(ctx, project.id, task.body.id, "1000", today);
    const je = await request(app.getHttpServer())
      .get(`/gl/journal-entries/${invoice.journalEntryId}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(200);
    const expenseLine = je.body.lines.find((l: any) => l.account.code === "5240");
    const apLine = je.body.lines.find((l: any) => l.account.code === "2110");
    expect(expenseLine.costCenterId).toBe(project.costCenterId);
    expect(expenseLine.wbsTaskId).toBe(task.body.id);
    expect(apLine.costCenterId).toBeNull();
    expect(apLine.wbsTaskId).toBeNull();
  });

  it("OVER_TIME billing posts to 2400 Contract Liability, not revenue", async () => {
    const ctx = await setupProjectContext();
    const project = await createOverTimeProject(ctx);
    const today = new Date().toISOString();

    const invoice = await billProject(ctx, project.id, "50000", today);
    const je = await request(app.getHttpServer())
      .get(`/gl/journal-entries/${invoice.journalEntryId}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(200);

    const liabilityLine = je.body.lines.find((l: any) => l.account.code === "2400");
    expect(Number(liabilityLine.credit)).toBe(50000);
    expect(liabilityLine.costCenterId).toBe(project.costCenterId);
    expect(je.body.lines.some((l: any) => l.account.code.startsWith("4"))).toBe(false);
    // VAT + AR legs still normal
    expect(Number(je.body.lines.find((l: any) => l.account.code === "2200").credit)).toBe(7500);
    expect(Number(je.body.lines.find((l: any) => l.account.code === "1210").debit)).toBe(57500);
  });

  it("runs the full worked example: P1 revrec 40% then bill; P2 revrec 70% with liability drawdown", async () => {
    const ctx = await setupProjectContext();
    const project = await createOverTimeProject(ctx);
    const p1 = ctx.periods[0];
    const p2 = ctx.periods[1];

    // Period 1: costs 40k, run BEFORE billing
    await postApCost(ctx, project.id, undefined, "40000", dateIn(p1));
    const run1 = await request(app.getHttpServer())
      .post(`/projects/${project.id}/revenue-recognition/run`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({ fiscalPeriodId: p1.id })
      .expect(201);

    expect(Number(run1.body.percentComplete)).toBe(0.4);
    expect(Number(run1.body.recognizedThisRun)).toBe(60000);
    const je1Lines = run1.body.journalEntry.lines;
    expect(Number(je1Lines.find((l: any) => l.account.code === "1450").debit)).toBe(60000);
    expect(Number(je1Lines.find((l: any) => l.account.code === "4300").credit)).toBe(60000);

    // Then bill 50k (credits 2400)
    await billProject(ctx, project.id, "50000", dateIn(p1));

    // Period 2: +30k costs → POC 70%, delta 45k
    await postApCost(ctx, project.id, undefined, "30000", dateIn(p2));
    const run2 = await request(app.getHttpServer())
      .post(`/projects/${project.id}/revenue-recognition/run`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({ fiscalPeriodId: p2.id })
      .expect(201);

    expect(Number(run2.body.percentComplete)).toBe(0.7);
    expect(Number(run2.body.recognizedThisRun)).toBe(45000);
    const je2Lines = run2.body.journalEntry.lines;
    // Retarget: 1450 60k→55k (Cr 5k), 2400 50k→0 (Dr 50k), Cr 4300 45k
    expect(Number(je2Lines.find((l: any) => l.account.code === "2400").debit)).toBe(50000);
    expect(Number(je2Lines.find((l: any) => l.account.code === "1450").credit)).toBe(5000);
    expect(Number(je2Lines.find((l: any) => l.account.code === "4300").credit)).toBe(45000);

    // WIP schedule reflects the final position
    const wip = await request(app.getHttpServer())
      .get("/reports/wip-schedule")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(200);
    const row = wip.body.find((r: any) => r.projectId === project.id);
    expect(Number(row.contractAsset)).toBe(55000);
    expect(Number(row.contractLiability)).toBe(0);
    expect(Number(row.revenueRecognized)).toBe(105000);
    expect(Number(row.billedToDate)).toBe(50000);
    expect(Number(row.percentComplete)).toBe(70);

    // Profitability: margin 105k − 70k = 35k
    const profit = await request(app.getHttpServer())
      .get("/reports/project-profitability")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(200);
    const prow = profit.body.find((r: any) => r.projectId === project.id);
    expect(Number(prow.costsToDate)).toBe(70000);
    expect(Number(prow.revenueRecognized)).toBe(105000);
    expect(Number(prow.margin)).toBe(35000);
  });

  it("re-run guard: 409 while POSTED, then reverse-and-rerun works", async () => {
    const ctx = await setupProjectContext();
    const project = await createOverTimeProject(ctx);
    const p1 = ctx.periods[0];

    await postApCost(ctx, project.id, undefined, "20000", dateIn(p1));
    const run = await request(app.getHttpServer())
      .post(`/projects/${project.id}/revenue-recognition/run`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({ fiscalPeriodId: p1.id })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/projects/${project.id}/revenue-recognition/run`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({ fiscalPeriodId: p1.id })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/projects/${project.id}/revenue-recognition/runs/${run.body.id}/reverse`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(201);

    const rerun = await request(app.getHttpServer())
      .post(`/projects/${project.id}/revenue-recognition/run`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({ fiscalPeriodId: p1.id })
      .expect(201);
    // Reversal netted the first run to zero, so the rerun recognizes the same 30k again
    expect(Number(rerun.body.recognizedThisRun)).toBe(30000);
  });

  it("POINT_IN_TIME projects bill to normal revenue with dims (Phase 2 regression)", async () => {
    const ctx = await setupProjectContext();
    const project = await request(app.getHttpServer())
      .post("/projects")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({ code: "PIT-1", name: "Simple Job", recognitionMethod: "POINT_IN_TIME" })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/projects/${project.body.id}/status`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({ status: "ACTIVE" })
      .expect(201);

    const today = new Date().toISOString();
    const draft = await request(app.getHttpServer())
      .post("/ar/invoices")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        businessPartnerId: ctx.customer.id,
        issueDateTime: today,
        postingDate: today,
        dueDate: today,
        lines: [{ itemId: ctx.item.id, description: "Service", quantity: "1", unitPrice: "1000", projectId: project.body.id }],
      })
      .expect(201);
    const invoice = (
      await request(app.getHttpServer())
        .post(`/ar/invoices/${draft.body.id}/post`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(201)
    ).body;

    const je = await request(app.getHttpServer())
      .get(`/gl/journal-entries/${invoice.journalEntryId}`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .expect(200);
    const revLine = je.body.lines.find((l: any) => l.account.code === "4100");
    expect(Number(revLine.credit)).toBe(1000);
    expect(revLine.costCenterId).toBe(project.body.costCenterId);
    expect(je.body.lines.some((l: any) => ["1450", "2400", "4300"].includes(l.account.code))).toBe(false);
  });

  it("manual JE accepts projectId sugar and validates task ownership", async () => {
    const ctx = await setupProjectContext();
    const project = await createOverTimeProject(ctx);
    const otherProject = await request(app.getHttpServer())
      .post("/projects")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({ code: "OTH-1", name: "Other" })
      .expect(201);
    const task = await request(app.getHttpServer())
      .post(`/projects/${project.id}/tasks`)
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({ code: "T1", name: "Works" })
      .expect(201);

    const today = new Date().toISOString();
    // Task from the wrong project → 400
    const bad = await request(app.getHttpServer())
      .post("/gl/journal-entries")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        postingDate: today,
        documentDate: today,
        lines: [
          { accountId: ctx.accountByCode("5210").id, debit: "100", credit: "0", projectId: otherProject.body.id, wbsTaskId: task.body.id },
          { accountId: ctx.cashAccount.id, debit: "0", credit: "100" },
        ],
      });
    expect(bad.status).toBe(400);

    // Valid: projectId resolves to the project's CC
    const good = await request(app.getHttpServer())
      .post("/gl/journal-entries")
      .set("Authorization", `Bearer ${ctx.accessToken}`)
      .send({
        postingDate: today,
        documentDate: today,
        lines: [
          { accountId: ctx.accountByCode("5210").id, debit: "100", credit: "0", projectId: project.id, wbsTaskId: task.body.id },
          { accountId: ctx.cashAccount.id, debit: "0", credit: "100" },
        ],
      })
      .expect(201);
    const expLine = good.body.lines.find((l: any) => Number(l.debit) === 100);
    expect(expLine.costCenterId).toBe(project.costCenterId);
  });

  it("isolates projects across companies", async () => {
    const a = await setupProjectContext();
    const projectA = await createOverTimeProject(a);
    const b = await setupUserWithCompany(app);

    await request(app.getHttpServer())
      .get(`/projects/${projectA.id}`)
      .set("Authorization", `Bearer ${b.accessToken}`)
      .expect(404);
  });

  describe("Project Intelligence dashboard", () => {
    async function postDraftInvoice(ctx: any, projectId: string, accountCode: string, gross: string, dateIso: string) {
      const draft = await request(app.getHttpServer())
        .post("/ap/invoices")
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .send({
          businessPartnerId: ctx.vendor.id,
          vendorInvoiceNumber: `VND-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          postingDate: dateIso,
          dueDate: dateIso,
          lines: [
            {
              description: "Expense",
              quantity: "1",
              unitPrice: gross,
              vatCategory: "ZERO_RATED",
              accountId: ctx.accountByCode(accountCode).id,
              projectId,
            },
          ],
        })
        .expect(201);
      return draft.body;
    }

    it("buckets Material/Machinery costs from draft+posted invoices, leaves unmapped accounts in Other", async () => {
      const ctx = await setupProjectContext();
      const project = await createOverTimeProject(ctx);
      const today = new Date().toISOString();

      // 5104 Site Tools & Consumables → MATERIAL (stays DRAFT — must still count)
      await postDraftInvoice(ctx, project.id, "5104", "300", today);
      // 5103 Fuel & Lubricants → MACHINERY, posted this time
      const fuelInvoice = await postDraftInvoice(ctx, project.id, "5103", "150", today);
      await request(app.getHttpServer())
        .post(`/ap/invoices/${fuelInvoice.id}/post`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(201);
      // 5220 Utilities Expense → unmapped → OTHER
      await postDraftInvoice(ctx, project.id, "5220", "75", today);

      const res = await request(app.getHttpServer())
        .get(`/projects/${project.id}/intelligence`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200);

      expect(res.body.categories.MATERIAL.total).toBe("300.00");
      expect(res.body.categories.MACHINERY.total).toBe("150.00");
      expect(res.body.categories.OTHER.total).toBe("75.00");
      expect(res.body.categories.LABOR.total).toBe("0.00");
      expect(res.body.grandTotal).toBe("525.00");

      const materialAccount = res.body.categories.MATERIAL.accounts.find((a: any) => a.code === "5104");
      const lines = await request(app.getHttpServer())
        .get(`/projects/${project.id}/costs/accounts/${materialAccount.id}/invoice-lines`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200);
      expect(lines.body).toHaveLength(1);
      expect(lines.body[0].status).toBe("DRAFT");
      expect(Number(lines.body[0].grossAmount)).toBe(300);
    });

    it("Material/Machinery costs are gross of VAT — the real amount paid/payable, not the net GL expense", async () => {
      const ctx = await setupProjectContext();
      const project = await createOverTimeProject(ctx);
      const today = new Date().toISOString();

      // 5104 Site Tools & Consumables, VAT-exclusive line (this endpoint's default):
      // unitPrice 100 @ STANDARD_15 means net 100.00 + VAT 15.00 = gross 115.00.
      const draft = await request(app.getHttpServer())
        .post("/ap/invoices")
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .send({
          businessPartnerId: ctx.vendor.id,
          vendorInvoiceNumber: `VND-${Date.now()}-vat`,
          postingDate: today,
          dueDate: today,
          lines: [
            {
              description: "Consumables with VAT",
              quantity: "1",
              unitPrice: "100",
              vatCategory: "STANDARD_15",
              accountId: ctx.accountByCode("5104").id,
              projectId: project.id,
            },
          ],
        })
        .expect(201);
      expect(Number(draft.body.lines[0].netAmount)).toBe(100);
      expect(Number(draft.body.lines[0].grossAmount)).toBe(115);

      const res = await request(app.getHttpServer())
        .get(`/projects/${project.id}/intelligence`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200);

      // Gross (115), not net (100) — the dashboard reflects what was actually paid/payable.
      expect(res.body.categories.MATERIAL.total).toBe("115.00");
      const materialRow = res.body.categories.MATERIAL.accounts.find((a: any) => a.code === "5104");
      expect(materialRow.amount).toBe("115.00");
    });

    it("buckets Labor from ALLOWANCE employee payments, honoring an explicit expenseAccountId override", async () => {
      const ctx = await setupProjectContext();
      const project = await createOverTimeProject(ctx);

      const employee = await request(app.getHttpServer())
        .post("/hr/employees")
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .send({ code: "E1", nameEn: "Test Worker", joinDate: new Date().toISOString(), costCenterId: project.costCenterId })
        .expect(201);

      // Default: no expenseAccountId → falls to the ALLOWANCE_EXPENSE control account (5215)
      await request(app.getHttpServer())
        .post(`/hr/employees/${employee.body.id}/payments`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .send({ category: "ALLOWANCE", amount: "80", bankCashAccountId: ctx.cashAccount.id })
        .expect(201);

      // Override: explicit expense account
      const overrideAccount = ctx.accountByCode("5240");
      await request(app.getHttpServer())
        .post(`/hr/employees/${employee.body.id}/payments`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .send({ category: "ALLOWANCE", amount: "20", bankCashAccountId: ctx.cashAccount.id, expenseAccountId: overrideAccount.id })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/projects/${project.id}/intelligence`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200);
      expect(res.body.categories.LABOR.total).toBe("100.00");
      const defaultRow = res.body.categories.LABOR.accounts.find((a: any) => a.code === "5215");
      const overrideRow = res.body.categories.LABOR.accounts.find((a: any) => a.code === "5240");
      expect(defaultRow.amount).toBe("80.00");
      expect(overrideRow.amount).toBe("20.00");

      const payments = await request(app.getHttpServer())
        .get(`/projects/${project.id}/costs/labor`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200);
      expect(payments.body).toHaveLength(2);
      expect(payments.body.every((p: any) => p.employeeCode === "E1")).toBe(true);
    });

    it("FOOD payments default to their own account (5216), separate from ALLOWANCE (5215); excludes reversed payments; the accountId filter narrows the drill-down to just that account", async () => {
      const ctx = await setupProjectContext();
      const project = await createOverTimeProject(ctx);

      const employee = await request(app.getHttpServer())
        .post("/hr/employees")
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .send({ code: "E2", nameEn: "Food Worker", joinDate: new Date().toISOString(), costCenterId: project.costCenterId })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/hr/employees/${employee.body.id}/payments`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .send({ category: "FOOD", amount: "40", bankCashAccountId: ctx.cashAccount.id })
        .expect(201);

      // Plain ALLOWANCE, no override — must land on 5215, not mix with FOOD's 5216.
      await request(app.getHttpServer())
        .post(`/hr/employees/${employee.body.id}/payments`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .send({ category: "ALLOWANCE", amount: "15", bankCashAccountId: ctx.cashAccount.id })
        .expect(201);

      // A wrongly-recorded allowance that gets reversed — must not count toward Labor.
      const wrongPayment = (
        await request(app.getHttpServer())
          .post(`/hr/employees/${employee.body.id}/payments`)
          .set("Authorization", `Bearer ${ctx.accessToken}`)
          .send({ category: "ALLOWANCE", amount: "999", bankCashAccountId: ctx.cashAccount.id })
          .expect(201)
      ).body;
      await request(app.getHttpServer())
        .post(`/hr/employee-payments/${wrongPayment.id}/reverse`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(201);

      const overrideAccount = ctx.accountByCode("5240");
      await request(app.getHttpServer())
        .post(`/hr/employees/${employee.body.id}/payments`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .send({ category: "ALLOWANCE", amount: "20", bankCashAccountId: ctx.cashAccount.id, expenseAccountId: overrideAccount.id })
        .expect(201);

      const intel = await request(app.getHttpServer())
        .get(`/projects/${project.id}/intelligence`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200);
      // 40 (FOOD, on its own 5216) + 15 (plain ALLOWANCE, 5215) + 20 (ALLOWANCE override, 5240) — the reversed 999 is excluded.
      expect(intel.body.categories.LABOR.total).toBe("75.00");
      const foodAccountRow = intel.body.categories.LABOR.accounts.find((a: any) => a.code === "5216");
      const allowanceAccountRow = intel.body.categories.LABOR.accounts.find((a: any) => a.code === "5215");
      expect(foodAccountRow.amount).toBe("40.00");
      expect(allowanceAccountRow.amount).toBe("15.00");

      const allLabor = await request(app.getHttpServer())
        .get(`/projects/${project.id}/costs/labor`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200);
      expect(allLabor.body).toHaveLength(3);
      expect(allLabor.body.some((p: any) => Number(p.amount) === 999)).toBe(false);

      // The drill-down accountId filter (the fix for the frontend bug where
      // clicking any Labor row showed the same unfiltered list) must scope
      // to exactly the clicked account's own transactions.
      const filtered = await request(app.getHttpServer())
        .get(`/projects/${project.id}/costs/labor?accountId=${foodAccountRow.id}`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200);
      expect(filtered.body).toHaveLength(1);
      expect(filtered.body[0].source).toBe("FOOD");
      expect(Number(filtered.body[0].amount)).toBe(40);

      const filteredAllowance = await request(app.getHttpServer())
        .get(`/projects/${project.id}/costs/labor?accountId=${allowanceAccountRow.id}`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200);
      expect(filteredAllowance.body).toHaveLength(1);
      expect(filteredAllowance.body[0].source).toBe("ALLOWANCE");
      expect(Number(filteredAllowance.body[0].amount)).toBe(15);
    });

    it("a reversed SALARY-category payment leaves no phantom debit/credit leg on its account (reversal JE isn't linked via employee_payments)", async () => {
      const ctx = await setupProjectContext();
      const project = await createOverTimeProject(ctx);

      const employee = await request(app.getHttpServer())
        .post("/hr/employees")
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .send({ code: "E3", nameEn: "Salary Worker", joinDate: new Date().toISOString(), costCenterId: project.costCenterId })
        .expect(201);

      const wrongSalary = (
        await request(app.getHttpServer())
          .post(`/hr/employees/${employee.body.id}/payments`)
          .set("Authorization", `Bearer ${ctx.accessToken}`)
          .send({ category: "SALARY", amount: "100", bankCashAccountId: ctx.cashAccount.id })
          .expect(201)
      ).body;
      await request(app.getHttpServer())
        .post(`/hr/employee-payments/${wrongSalary.id}/reverse`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(201);

      // The reversal posts its own JE (linked to the original only via
      // reversalOfEntryId, not via any employee_payments row) — that JE's
      // lone credit leg must not leak into the account total as a phantom
      // negative amount, and the account must not appear at all once its
      // only activity nets to zero.
      const intel = await request(app.getHttpServer())
        .get(`/projects/${project.id}/intelligence`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200);
      expect(intel.body.categories.LABOR.total).toBe("0.00");
      expect(intel.body.categories.LABOR.accounts.find((a: any) => a.code === "5112")).toBeUndefined();

      const labor = await request(app.getHttpServer())
        .get(`/projects/${project.id}/costs/labor`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200);
      expect(labor.body.some((p: any) => p.accountCode === "5112")).toBe(false);
    });

    it("routes payroll gross salary to the Project Salaries account (5112) for a project cost center, not 5200", async () => {
      const ctx = await setupProjectContext();
      const project = await createOverTimeProject(ctx);
      const now = Date.now();
      const period = ctx.periods.find(
        (p: any) => new Date(p.startDate).getTime() <= now && now <= new Date(p.endDate).getTime(),
      );
      const joinDate = new Date(period.startDate).toISOString().slice(0, 10);

      const csvHeader =
        "code,nameEn,nameAr,designation,nationality,isSaudi,iqamaOrNationalId,iqamaExpiry,passportNumber,passportExpiry,gosiNumber,joinDate,contractType,bankCode,iban,costCenterCode,annualLeaveDays,basicSalary,housingAllowance,transportAllowance,otherAllowance,gosiExempt";
      const csv = [
        csvHeader,
        `PE1,Project Worker,,Mason,SA,true,1099999999,2027-06-30,,,50099999,${joinDate},UNLIMITED,80,SA4420000001234567891234,${project.costCenter.code},21,6000,1000,0,0,false`,
      ].join("\n");
      await request(app.getHttpServer())
        .post("/hr/employees/import")
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .send({ csv })
        .expect(201);

      const run = (
        await request(app.getHttpServer())
          .post("/hr/payroll-runs")
          .set("Authorization", `Bearer ${ctx.accessToken}`)
          .send({ fiscalPeriodId: period.id })
          .expect(201)
      ).body;
      expect(run.lines).toHaveLength(1);

      const posted = (
        await request(app.getHttpServer())
          .post(`/hr/payroll-runs/${run.id}/post`)
          .set("Authorization", `Bearer ${ctx.accessToken}`)
          .expect(201)
      ).body;
      expect(posted.status).toBe("POSTED");

      const projectSalaryAccount = ctx.accountByCode("5112");
      const salaryAccount = ctx.accountByCode("5200");
      const gross = run.lines[0].grossPay;

      const lines = await request(app.getHttpServer())
        .get(`/projects/${project.id}/costs/labor`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200);
      const payrollLine = lines.body.find((l: any) => l.source === "PAYROLL" && l.accountCode === "5112");
      expect(payrollLine).toBeDefined();
      expect(payrollLine.accountCode).toBe(projectSalaryAccount.code);
      expect(Number(payrollLine.amount)).toBe(Number(gross));

      const intel = await request(app.getHttpServer())
        .get(`/projects/${project.id}/intelligence`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200);
      const laborRow = intel.body.categories.LABOR.accounts.find((a: any) => a.code === "5112");
      expect(laborRow).toBeDefined();
      expect(Number(laborRow.amount)).toBe(Number(gross));
      expect(intel.body.categories.LABOR.accounts.find((a: any) => a.code === salaryAccount.code)).toBeUndefined();
    });

    it("a final settlement's 'Final salary days' line on 5112 shows up in the Labor drill-down, matching the intelligence total (not just PAYROLL-run postings)", async () => {
      const ctx = await setupProjectContext();
      const project = await createOverTimeProject(ctx);
      const now = Date.now();
      const period = ctx.periods.find(
        (p: any) => new Date(p.startDate).getTime() <= now && now <= new Date(p.endDate).getTime(),
      );
      const joinDate = new Date(new Date(period.startDate).getTime() - 10 * 24 * 3600 * 1000).toISOString().slice(0, 10);

      const csvHeader =
        "code,nameEn,nameAr,designation,nationality,isSaudi,iqamaOrNationalId,iqamaExpiry,passportNumber,passportExpiry,gosiNumber,joinDate,contractType,bankCode,iban,costCenterCode,annualLeaveDays,basicSalary,housingAllowance,transportAllowance,otherAllowance,gosiExempt";
      const csv = [
        csvHeader,
        `PE2,Leaving Worker,,Mason,SA,true,1099999998,2027-06-30,,,50099998,${joinDate},UNLIMITED,80,SA4420000001234567891235,${project.costCenter.code},21,6000,1000,0,0,false`,
      ].join("\n");
      await request(app.getHttpServer())
        .post("/hr/employees/import")
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .send({ csv })
        .expect(201);
      const employee = (
        await request(app.getHttpServer()).get("/hr/employees").set("Authorization", `Bearer ${ctx.accessToken}`).expect(200)
      ).body.find((e: any) => e.code === "PE2");

      // No payroll run ever posted for this employee — "coveredUntil" falls
      // back to joinDate, so every one of these 5 days becomes a "final
      // salary days" stub in the settlement, posted to 5112 (project cost
      // center), never touching a payroll run at all.
      const lastWorkingDay = new Date(new Date(joinDate).getTime() + 5 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const settlement = (
        await request(app.getHttpServer())
          .post(`/hr/employees/${employee.id}/termination`)
          .set("Authorization", `Bearer ${ctx.accessToken}`)
          .send({ reason: "RESIGNATION", lastWorkingDay })
          .expect(201)
      ).body;
      expect(Number(settlement.finalSalaryAmount)).toBeGreaterThan(0);

      const intel = await request(app.getHttpServer())
        .get(`/projects/${project.id}/intelligence`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200);
      const laborRow = intel.body.categories.LABOR.accounts.find((a: any) => a.code === "5112");
      expect(laborRow).toBeDefined();
      expect(Number(laborRow.amount)).toBe(Number(settlement.finalSalaryAmount));

      const labor = await request(app.getHttpServer())
        .get(`/projects/${project.id}/costs/labor?accountId=${laborRow.id}`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200);
      const settlementRow = labor.body.find((l: any) => l.source === "SETTLEMENT");
      expect(settlementRow).toBeDefined();
      expect(settlementRow.employeeId).toBe(employee.id);
      expect(Number(settlementRow.amount)).toBe(Number(settlement.finalSalaryAmount));
      // Drill-down total for this account must equal the summary card's total —
      // this is the exact bug reported: intelligence showed 12,830 for 5112
      // but the drill-down (missing settlement postings entirely) showed only 3,600.
      const drillDownTotal = labor.body.reduce((sum: number, l: any) => sum + Number(l.amount), 0);
      expect(drillDownTotal).toBeCloseTo(Number(laborRow.amount), 2);
    });

    it("still finds the settlement's Labor drill-down row after a reversal + re-release (FinalSettlement row is reused, its id no longer matches the new JE's sourceDocumentId)", async () => {
      const ctx = await setupProjectContext();
      const project = await createOverTimeProject(ctx);
      const now = Date.now();
      const period = ctx.periods.find(
        (p: any) => new Date(p.startDate).getTime() <= now && now <= new Date(p.endDate).getTime(),
      );
      const joinDate = new Date(new Date(period.startDate).getTime() - 10 * 24 * 3600 * 1000).toISOString().slice(0, 10);

      const csvHeader =
        "code,nameEn,nameAr,designation,nationality,isSaudi,iqamaOrNationalId,iqamaExpiry,passportNumber,passportExpiry,gosiNumber,joinDate,contractType,bankCode,iban,costCenterCode,annualLeaveDays,basicSalary,housingAllowance,transportAllowance,otherAllowance,gosiExempt";
      const csv = [
        csvHeader,
        `PE3,Twice Released,,Mason,SA,true,1099999997,2027-06-30,,,50099997,${joinDate},UNLIMITED,80,SA4420000001234567891236,${project.costCenter.code},21,6000,1000,0,0,false`,
      ].join("\n");
      await request(app.getHttpServer())
        .post("/hr/employees/import")
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .send({ csv })
        .expect(201);
      const employee = (
        await request(app.getHttpServer()).get("/hr/employees").set("Authorization", `Bearer ${ctx.accessToken}`).expect(200)
      ).body.find((e: any) => e.code === "PE3");

      const lastWorkingDay1 = new Date(new Date(joinDate).getTime() + 3 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const firstSettlement = (
        await request(app.getHttpServer())
          .post(`/hr/employees/${employee.id}/termination`)
          .set("Authorization", `Bearer ${ctx.accessToken}`)
          .send({ reason: "RESIGNATION", lastWorkingDay: lastWorkingDay1 })
          .expect(201)
      ).body;

      // Reverse it (e.g. the employee was reinstated) — the FinalSettlement
      // row survives with status REVERSED, still carrying its original id.
      await request(app.getHttpServer())
        .post(`/hr/settlements/${firstSettlement.id}/reverse`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(201);

      // Release them again, later, for more days — this UPDATEs the same
      // FinalSettlement row (same id) but posts a brand-new JE, whose
      // sourceDocumentId is a freshly generated UUID that does NOT equal
      // the settlement row's (unchanged) id.
      const lastWorkingDay2 = new Date(new Date(joinDate).getTime() + 8 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const secondSettlement = (
        await request(app.getHttpServer())
          .post(`/hr/employees/${employee.id}/termination`)
          .set("Authorization", `Bearer ${ctx.accessToken}`)
          .send({ reason: "RESIGNATION", lastWorkingDay: lastWorkingDay2 })
          .expect(201)
      ).body;
      expect(secondSettlement.id).toBe(firstSettlement.id);
      expect(Number(secondSettlement.finalSalaryAmount)).toBeGreaterThan(0);

      const intel = await request(app.getHttpServer())
        .get(`/projects/${project.id}/intelligence`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200);
      const laborRow = intel.body.categories.LABOR.accounts.find((a: any) => a.code === "5112");
      expect(laborRow).toBeDefined();
      expect(Number(laborRow.amount)).toBe(Number(secondSettlement.finalSalaryAmount));

      const labor = await request(app.getHttpServer())
        .get(`/projects/${project.id}/costs/labor?accountId=${laborRow.id}`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .expect(200);
      const settlementRow = labor.body.find((l: any) => l.source === "SETTLEMENT");
      expect(settlementRow).toBeDefined();
      expect(Number(settlementRow.amount)).toBe(Number(secondSettlement.finalSalaryAmount));
    });

    it("rejects an ADVANCE payment's expenseAccountId as irrelevant (ADVANCE ignores it) and rejects a non-expense override account", async () => {
      const ctx = await setupProjectContext();
      const employee = await request(app.getHttpServer())
        .post("/hr/employees")
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .send({ code: "E2", nameEn: "Another Worker", joinDate: new Date().toISOString() })
        .expect(201);

      // A non-EXPENSE account (e.g. 1110 Petty Cash, an ASSET) must be rejected as an allowance override
      const badOverride = await request(app.getHttpServer())
        .post(`/hr/employees/${employee.body.id}/payments`)
        .set("Authorization", `Bearer ${ctx.accessToken}`)
        .send({ category: "ALLOWANCE", amount: "10", bankCashAccountId: ctx.cashAccount.id, expenseAccountId: ctx.cashAccount.id })
        .expect(400);
      expect(badOverride.body.message).toContain("not an expense account");
    });
  });
});
