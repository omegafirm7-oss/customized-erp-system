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
});
