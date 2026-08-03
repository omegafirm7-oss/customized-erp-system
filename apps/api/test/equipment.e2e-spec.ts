import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, getPrisma, setupUserWithCompany, createPartner } from "./utils/test-app";

describe("Equipment Rental & Fixed Assets (e2e)", () => {
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

  async function currentPeriod(ctx: any) {
    const res = await request(app.getHttpServer())
      .get("/companies/current/fiscal-periods")
      .set(auth(ctx.accessToken))
      .expect(200);
    const now = Date.now();
    const period = res.body.find(
      (p: any) => new Date(p.startDate).getTime() <= now && now <= new Date(p.endDate).getTime(),
    );
    return { period, periods: res.body };
  }

  function periodDays(period: any): number {
    const start = new Date(period.startDate);
    const end = new Date(period.endDate);
    return Math.ceil((end.getTime() - start.getTime()) / (24 * 3600 * 1000));
  }

  // Worked-example chain (its run in file order)
  let wctx: any;
  let wPeriod: any;
  let wContract: any;
  let wCrane: any;
  let wGenerator: any;
  let wUsageLogId: string;
  let wInvoiceId: string;
  let wGenAssignmentId: string;
  let expectedGenAmount: number;

  it("registers equipment with a capitalization JE (Dr 1512 / Cr bank)", async () => {
    wctx = await setupManpowerlessContext();
    const { period } = await currentPeriod(wctx);
    wPeriod = period;

    // Crane 240,000 / salvage 24,000 / 72 months, capitalized from bank 1120
    const bank = wctx.accountByCode("1120");
    wCrane = (
      await request(app.getHttpServer())
        .post("/equipment/units")
        .set(auth(wctx.accessToken))
        .send({
          code: "CRN-1",
          name: "Tower Crane",
          category: "Cranes",
          acquisitionDate: new Date(period.startDate).toISOString().slice(0, 10),
          acquisitionCost: "240000",
          salvageValue: "24000",
          usefulLifeMonths: 72,
          capitalizationCreditAccountId: bank.id,
        })
        .expect(201)
    ).body;
    expect(wCrane.capitalizationJournalEntryId).toBeTruthy();

    const prisma = getPrisma(app);
    const je = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: wCrane.capitalizationJournalEntryId },
      include: { lines: { include: { account: true } } },
    });
    expect(je.lines.find((l) => l.account.code === "1512")!.debit.toString()).toBe("240000");
    expect(je.lines.find((l) => l.account.code === "1120")!.credit.toString()).toBe("240000");

    // Generator 36,000 / 36 months, already on the books (no JE)
    wGenerator = (
      await request(app.getHttpServer())
        .post("/equipment/units")
        .set(auth(wctx.accessToken))
        .send({
          code: "GEN-1",
          name: "Diesel Generator",
          acquisitionDate: new Date(period.startDate).toISOString().slice(0, 10),
          acquisitionCost: "36000",
          usefulLifeMonths: 36,
        })
        .expect(201)
    ).body;
    expect(wGenerator.capitalizationJournalEntryId).toBeNull();
  });

  async function setupManpowerlessContext() {
    const ctx = await setupUserWithCompany(app);
    const customer = await createPartner(app, ctx.accessToken, "CUSTOMER");
    return { ...ctx, customer };
  }

  it("creates a contract with its EQR cost center and enforces cross-contract exclusivity", async () => {
    const startDate = new Date(wPeriod.startDate).toISOString().slice(0, 10);
    wContract = (
      await request(app.getHttpServer())
        .post("/equipment/contracts")
        .set(auth(wctx.accessToken))
        .send({ code: "EQC-1", name: "Site Rental", businessPartnerId: wctx.customer.id, startDate })
        .expect(201)
    ).body;
    expect(wContract.costCenter.code).toBe("EQR-EQC-1");

    // CRN-1 MONTHLY 15,000; GEN-1 DAILY 400
    await request(app.getHttpServer())
      .post(`/equipment/contracts/${wContract.id}/assignments`)
      .set(auth(wctx.accessToken))
      .send({ equipmentId: wCrane.id, rateBasis: "MONTHLY", billRate: "15000", startDate })
      .expect(201);
    const genAsg = (
      await request(app.getHttpServer())
        .post(`/equipment/contracts/${wContract.id}/assignments`)
        .set(auth(wctx.accessToken))
        .send({ equipmentId: wGenerator.id, rateBasis: "DAILY", billRate: "400", startDate })
        .expect(201)
    ).body;
    wGenAssignmentId = genAsg.id;

    // A second contract cannot take the same unit in an overlapping window
    const contract2 = (
      await request(app.getHttpServer())
        .post("/equipment/contracts")
        .set(auth(wctx.accessToken))
        .send({ code: "EQC-2", name: "Other Site", businessPartnerId: wctx.customer.id, startDate })
        .expect(201)
    ).body;
    await request(app.getHttpServer())
      .post(`/equipment/contracts/${contract2.id}/assignments`)
      .set(auth(wctx.accessToken))
      .send({ equipmentId: wCrane.id, rateBasis: "DAILY", billRate: "900", startDate })
      .expect(409);

    // Disposal is blocked while actively assigned
    await request(app.getHttpServer())
      .post(`/equipment/units/${wCrane.id}/dispose`)
      .set(auth(wctx.accessToken))
      .send({ proceeds: "0", proceedsAccountId: wctx.accountByCode("1120").id })
      .expect(409);
  });

  it("usage log prefills, records breakdown days, approves and bills exactly", async () => {
    const log = (
      await request(app.getHttpServer())
        .post(`/equipment/contracts/${wContract.id}/usage-logs`)
        .set(auth(wctx.accessToken))
        .send({ fiscalPeriodId: wPeriod.id })
        .expect(201)
    ).body;
    wUsageLogId = log.id;
    const days = periodDays(wPeriod);
    expect(log.entries).toHaveLength(days * 2);

    // GEN-1: 3 BREAKDOWN days
    const genEntries = log.entries.filter((e: any) => e.assignmentId === wGenAssignmentId);
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post(`/equipment/usage-logs/${wUsageLogId}/entries`)
        .set(auth(wctx.accessToken))
        .send({ assignmentId: wGenAssignmentId, date: genEntries[i].date.slice(0, 10), dayStatus: "BREAKDOWN" })
        .expect(201);
    }

    // Billing a DRAFT log → 409; approve; entries lock
    await request(app.getHttpServer())
      .post(`/equipment/usage-logs/${wUsageLogId}/generate-invoice`)
      .set(auth(wctx.accessToken))
      .expect(409);
    await request(app.getHttpServer())
      .post(`/equipment/usage-logs/${wUsageLogId}/approve`)
      .set(auth(wctx.accessToken))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/equipment/usage-logs/${wUsageLogId}/entries`)
      .set(auth(wctx.accessToken))
      .send({ assignmentId: wGenAssignmentId, date: genEntries[5].date.slice(0, 10), dayStatus: "IDLE" })
      .expect(409);

    const invoice = (
      await request(app.getHttpServer())
        .post(`/equipment/usage-logs/${wUsageLogId}/generate-invoice`)
        .set(auth(wctx.accessToken))
        .expect(201)
    ).body;
    wInvoiceId = invoice.id;

    // CRN-1 MONTHLY: 15,000/30 × min(days, 30) = 15,000 for a full month
    // GEN-1 DAILY: (days − 3) × 400
    expectedGenAmount = (days - 3) * 400;
    expect(invoice.lines).toHaveLength(2);
    const amounts = invoice.lines.map((l: any) => Number(l.netAmount)).sort((a: number, b: number) => a - b);
    expect(amounts).toEqual([expectedGenAmount, 15000].sort((a, b) => a - b));
    const prisma = getPrisma(app);
    const account4500 = await prisma.account.findFirst({ where: { companyId: wctx.companyId, code: "4500" } });
    for (const line of invoice.lines) {
      expect(line.costCenterId).toBe(wContract.costCenterId);
      expect(line.revenueAccountId).toBe(account4500!.id);
    }

    // Double-bill blocked; posting stamps the CC on the 4500 legs
    await request(app.getHttpServer())
      .post(`/equipment/usage-logs/${wUsageLogId}/generate-invoice`)
      .set(auth(wctx.accessToken))
      .expect(409);
    await request(app.getHttpServer()).post(`/ar/invoices/${wInvoiceId}/post`).set(auth(wctx.accessToken)).expect(201);
    const inv = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: wInvoiceId } });
    const je = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: inv.journalEntryId! },
      include: { lines: { include: { account: true } } },
    });
    const revenueLegs = je.lines.filter((l) => l.account.code === "4500");
    expect(revenueLegs.every((l) => l.costCenterId === wContract.costCenterId)).toBe(true);
    expect(revenueLegs.reduce((acc, l) => acc + Number(l.credit), 0)).toBeCloseTo(15000 + expectedGenAmount, 2);
  });

  it("project equipment: internal-use assignment accrues dayRate × days-used into the project's Machinery cost, blocks cross-assignment overlap", async () => {
    const ctx = await setupManpowerlessContext();
    const { period } = await currentPeriod(ctx);
    const startDate = new Date(period.startDate).toISOString().slice(0, 10);

    const project = (
      await request(app.getHttpServer())
        .post("/projects")
        .set(auth(ctx.accessToken))
        .send({ code: "PEQ-1", name: "Site A", businessPartnerId: ctx.customer.id, contractValue: "0", estimatedTotalCost: "0" })
        .expect(201)
    ).body;

    // Equipment with no internalDayRate set — assigning without an override is rejected.
    const van = (
      await request(app.getHttpServer())
        .post("/equipment/units")
        .set(auth(ctx.accessToken))
        .send({ code: "HIACE-2", name: "Hiace Van", acquisitionDate: startDate, acquisitionCost: "70000", usefulLifeMonths: 60 })
        .expect(201)
    ).body;
    await request(app.getHttpServer())
      .post("/equipment/project-assignments")
      .set(auth(ctx.accessToken))
      .send({ projectId: project.id, equipmentId: van.id, startDate })
      .expect(400);

    // Set a day rate on the unit, then assign — should succeed and snapshot the rate.
    await request(app.getHttpServer())
      .patch(`/equipment/units/${van.id}`)
      .set(auth(ctx.accessToken))
      .send({ internalDayRate: "250" })
      .expect(200);
    const assignment = (
      await request(app.getHttpServer())
        .post("/equipment/project-assignments")
        .set(auth(ctx.accessToken))
        .send({ projectId: project.id, equipmentId: van.id, startDate })
        .expect(201)
    ).body;
    expect(Number(assignment.dayRate)).toBe(250);

    // A second project can't take the same still-active unit.
    const project2 = (
      await request(app.getHttpServer())
        .post("/projects")
        .set(auth(ctx.accessToken))
        .send({ code: "PEQ-2", name: "Site B", businessPartnerId: ctx.customer.id, contractValue: "0", estimatedTotalCost: "0" })
        .expect(201)
    ).body;
    await request(app.getHttpServer())
      .post("/equipment/project-assignments")
      .set(auth(ctx.accessToken))
      .send({ projectId: project2.id, equipmentId: van.id, startDate, dayRate: "300" })
      .expect(409);

    // Prefill the timesheet, mark 3 days used, 1 day unused — accrual is 3 × 250.
    const filled = (
      await request(app.getHttpServer())
        .post(`/equipment/projects/${project.id}/timesheet/prefill?fiscalPeriodId=${period.id}`)
        .set(auth(ctx.accessToken))
        .expect(201)
    ).body;
    const entries = filled.assignments[0].entries;
    expect(entries.length).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post(`/equipment/projects/${project.id}/timesheet/entries`)
        .set(auth(ctx.accessToken))
        .send({ assignmentId: assignment.id, date: entries[i].date.slice(0, 10), used: true, hoursUsed: "8" })
        .expect(201);
    }
    // entries[3] stays at its prefilled default (used: false) — proves the accrual is real, not "every entry".

    const intelligence = (
      await request(app.getHttpServer())
        .get(`/projects/${project.id}/intelligence`)
        .set(auth(ctx.accessToken))
        .expect(200)
    ).body;
    expect(Number(intelligence.categories.MACHINERY.pending)).toBe(750);
    expect(Number(intelligence.categories.MACHINERY.total)).toBe(750);

    // Attachment is one per project per period, same as the HR timesheet's own period attachment.
    const fileBytes = Buffer.from("hiace log sheet");
    await request(app.getHttpServer())
      .post(`/equipment/projects/${project.id}/period-attachment?fiscalPeriodId=${period.id}`)
      .set(auth(ctx.accessToken))
      .attach("file", fileBytes, { filename: "hiace-log.pdf", contentType: "application/pdf" })
      .expect(201);
    const withAttachment = (
      await request(app.getHttpServer())
        .get(`/equipment/projects/${project.id}/timesheet?fiscalPeriodId=${period.id}`)
        .set(auth(ctx.accessToken))
        .expect(200)
    ).body;
    expect(withAttachment.periodAttachmentFilename).toBe("hiace-log.pdf");

    // Ending the assignment frees the unit for a new one.
    await request(app.getHttpServer())
      .post(`/equipment/project-assignments/${assignment.id}/end`)
      .set(auth(ctx.accessToken))
      .expect(201);
    await request(app.getHttpServer())
      .post("/equipment/project-assignments")
      .set(auth(ctx.accessToken))
      .send({ projectId: project2.id, equipmentId: van.id, startDate, dayRate: "300" })
      .expect(201);
  });

  it("usage-log entries record overtime hours (reporting only) and accept an attachment per day", async () => {
    const ctx = await setupManpowerlessContext();
    const { period } = await currentPeriod(ctx);
    const startDate = new Date(period.startDate).toISOString().slice(0, 10);

    const van = (
      await request(app.getHttpServer())
        .post("/equipment/units")
        .set(auth(ctx.accessToken))
        .send({
          code: "HIACE-1",
          name: "Hiace Van",
          acquisitionDate: startDate,
          acquisitionCost: "80000",
          usefulLifeMonths: 60,
        })
        .expect(201)
    ).body;
    const contract = (
      await request(app.getHttpServer())
        .post("/equipment/contracts")
        .set(auth(ctx.accessToken))
        .send({ code: "EQC-OT", name: "Project Transport", businessPartnerId: ctx.customer.id, startDate })
        .expect(201)
    ).body;
    const assignment = (
      await request(app.getHttpServer())
        .post(`/equipment/contracts/${contract.id}/assignments`)
        .set(auth(ctx.accessToken))
        .send({ equipmentId: van.id, rateBasis: "DAILY", billRate: "300", startDate })
        .expect(201)
    ).body;
    const log = (
      await request(app.getHttpServer())
        .post(`/equipment/contracts/${contract.id}/usage-logs`)
        .set(auth(ctx.accessToken))
        .send({ fiscalPeriodId: period.id })
        .expect(201)
    ).body;
    const firstEntry = log.entries[0];
    expect(Number(firstEntry.overtimeHours)).toBe(0);
    expect(firstEntry.attachment).toBeNull();

    // Overtime is editable while the log is still a draft, independent of dayStatus/hoursUsed.
    await request(app.getHttpServer())
      .post(`/equipment/usage-logs/${log.id}/entries`)
      .set(auth(ctx.accessToken))
      .send({ assignmentId: assignment.id, date: firstEntry.date.slice(0, 10), dayStatus: "ON_RENT", overtimeHours: "3" })
      .expect(201);
    const afterOt = (
      await request(app.getHttpServer()).get(`/equipment/usage-logs/${log.id}`).set(auth(ctx.accessToken)).expect(200)
    ).body;
    const updatedEntry = afterOt.entries.find((e: any) => e.id === firstEntry.id);
    expect(Number(updatedEntry.overtimeHours)).toBe(3);

    // Attach a file to that day's entry, then fetch it back byte-for-byte.
    const fileBytes = Buffer.from("gate pass photo bytes");
    await request(app.getHttpServer())
      .post(`/equipment/usage-logs/entries/${firstEntry.id}/attachment`)
      .set(auth(ctx.accessToken))
      .attach("file", fileBytes, { filename: "gate-pass.png", contentType: "image/png" })
      .expect(201);
    const download = await request(app.getHttpServer())
      .get(`/equipment/usage-logs/entries/${firstEntry.id}/attachment`)
      .set(auth(ctx.accessToken))
      .expect(200);
    expect(download.body.equals(fileBytes)).toBe(true);

    const afterAttach = (
      await request(app.getHttpServer()).get(`/equipment/usage-logs/${log.id}`).set(auth(ctx.accessToken)).expect(200)
    ).body;
    const attachedEntry = afterAttach.entries.find((e: any) => e.id === firstEntry.id);
    expect(attachedEntry.attachment.filename).toBe("gate-pass.png");
  });

  it("depreciation run posts 4,000 to the contract CC and enforces run ordering", async () => {
    const run = (
      await request(app.getHttpServer())
        .post("/equipment/depreciation-runs")
        .set(auth(wctx.accessToken))
        .send({ fiscalPeriodId: wPeriod.id })
        .expect(201)
    ).body;
    expect(run.runNumber).toMatch(/^DEPR-/);
    // Crane 3,000 + generator 1,000
    expect(Number(run.totalAmount)).toBe(4000);
    const craneLine = run.lines.find((l: any) => l.equipment.code === "CRN-1");
    expect(Number(craneLine.amount)).toBe(3000);
    expect(Number(craneLine.nbvAfter)).toBe(237000);

    const prisma = getPrisma(app);
    const je = await prisma.journalEntry.findFirst({
      where: { companyId: wctx.companyId, sourceDocumentId: run.id },
      include: { lines: { include: { account: true, costCenter: true } } },
    });
    // Both units assigned to EQC-1 → one CC-tagged 5230 debit leg of 4,000
    const exp = je!.lines.filter((l) => l.account.code === "5230");
    expect(exp).toHaveLength(1);
    expect(exp[0].debit.toString()).toBe("4000");
    expect(exp[0].costCenter?.code).toBe("EQR-EQC-1");
    const accum = je!.lines.find((l) => l.account.code === "1519");
    expect(accum!.credit.toString()).toBe("4000");
    expect(accum!.costCenterId).toBeNull();

    // Second run for the same period → 409
    await request(app.getHttpServer())
      .post("/equipment/depreciation-runs")
      .set(auth(wctx.accessToken))
      .send({ fiscalPeriodId: wPeriod.id })
      .expect(409);

    // Next period accumulates (crane 6,000 / generator 2,000 total by then)
    const { periods } = await currentPeriod(wctx);
    const nextPeriod = periods.find((p: any) => p.periodNumber === wPeriod.periodNumber + 1);
    const run2 = (
      await request(app.getHttpServer())
        .post("/equipment/depreciation-runs")
        .set(auth(wctx.accessToken))
        .send({ fiscalPeriodId: nextPeriod.id })
        .expect(201)
    ).body;
    const craneLine2 = run2.lines.find((l: any) => l.equipment.code === "CRN-1");
    expect(Number(craneLine2.accumulatedAfter)).toBe(6000);

    // Reversing the EARLIER run while a later one is posted → 409; latest OK
    await request(app.getHttpServer())
      .post(`/equipment/depreciation-runs/${run.id}/reverse`)
      .set(auth(wctx.accessToken))
      .expect(409);
    await request(app.getHttpServer())
      .post(`/equipment/depreciation-runs/${run2.id}/reverse`)
      .set(auth(wctx.accessToken))
      .expect(201);

    // Fleet register reflects the surviving accumulated 4,000
    const fleet = (
      await request(app.getHttpServer())
        .get("/equipment/reports/fleet-register")
        .set(auth(wctx.accessToken))
        .expect(200)
    ).body;
    const crane = fleet.find((r: any) => r.code === "CRN-1");
    expect(Number(crane.accumulatedDepreciation)).toBe(3000);
    expect(Number(crane.netBookValue)).toBe(237000);
  });

  it("AP maintenance line with the contract CC lands in profitability", async () => {
    const vendor = await createPartner(app, wctx.accessToken, "VENDOR");
    const draft = (
      await request(app.getHttpServer())
        .post("/ap/invoices")
        .set(auth(wctx.accessToken))
        .send({
          businessPartnerId: vendor.id,
          vendorInvoiceNumber: "REP-001",
          postingDate: new Date().toISOString(),
          dueDate: new Date().toISOString(),
          lines: [
            {
              description: "Generator repair",
              quantity: "1",
              unitPrice: "500",
              accountId: wctx.accountByCode("5240").id,
              costCenterId: wContract.costCenterId,
            },
          ],
        })
        .expect(201)
    ).body;
    await request(app.getHttpServer()).post(`/ap/invoices/${draft.id}/post`).set(auth(wctx.accessToken)).expect(201);

    const prisma = getPrisma(app);
    const inv = await prisma.purchaseInvoice.findUniqueOrThrow({ where: { id: draft.id } });
    const je = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: inv.journalEntryId! },
      include: { lines: { include: { account: true } } },
    });
    const expenseLeg = je.lines.find((l) => l.account.code === "5240");
    expect(expenseLeg!.costCenterId).toBe(wContract.costCenterId);

    // Profitability: billed − depreciation (run 1 survives: crane 3,000 +
    // generator 1,000 = 4,000; the reversed run 2 nets itself out) − 500
    const report = (
      await request(app.getHttpServer())
        .get("/equipment/reports/contract-profitability")
        .set(auth(wctx.accessToken))
        .expect(200)
    ).body;
    const row = report.find((r: any) => r.code === "EQC-1");
    const billed = 15000 + expectedGenAmount;
    expect(Number(row.billed)).toBeCloseTo(billed, 2);
    expect(Number(row.depreciation)).toBe(4000);
    expect(Number(row.otherCosts)).toBe(500);
    expect(Number(row.margin)).toBeCloseTo(billed - 4000 - 500, 2);
  });

  it("disposal posts the exact gain/loss and blocks reuse", async () => {
    // Free the generator: end its assignment; its usage log is INVOICED so
    // disposal is allowed
    await request(app.getHttpServer())
      .patch(`/equipment/contracts/${wContract.id}/assignments/${wGenAssignmentId}`)
      .set(auth(wctx.accessToken))
      .send({ isActive: false })
      .expect(200);

    // Generator: cost 36,000, accumulated 1,000 (run 1) → NBV 35,000.
    // Sell for 36,500 → gain 1,500 (credit 4950).
    const bank = wctx.accountByCode("1120");
    const disposed = (
      await request(app.getHttpServer())
        .post(`/equipment/units/${wGenerator.id}/dispose`)
        .set(auth(wctx.accessToken))
        .send({ proceeds: "36500", proceedsAccountId: bank.id })
        .expect(201)
    ).body;
    expect(disposed.status).toBe("DISPOSED");

    const prisma = getPrisma(app);
    const je = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: disposed.disposalJournalEntryId },
      include: { lines: { include: { account: true } } },
    });
    const leg = (code: string) => je.lines.find((l) => l.account.code === code)!;
    expect(leg("1519").debit.toString()).toBe("1000");
    expect(leg("1120").debit.toString()).toBe("36500");
    expect(leg("1512").credit.toString()).toBe("36000");
    expect(leg("4950").credit.toString()).toBe("1500");

    // Disposed units cannot be assigned
    await request(app.getHttpServer())
      .post(`/equipment/contracts/${wContract.id}/assignments`)
      .set(auth(wctx.accessToken))
      .send({
        equipmentId: wGenerator.id,
        rateBasis: "DAILY",
        billRate: "400",
        startDate: new Date().toISOString().slice(0, 10),
      })
      .expect(409);
  });

  it("isolates equipment data between companies", async () => {
    const b = await setupUserWithCompany(app);
    const fleet = (
      await request(app.getHttpServer()).get("/equipment/units").set(auth(b.accessToken)).expect(200)
    ).body;
    expect(fleet).toHaveLength(0);
    await request(app.getHttpServer())
      .get(`/equipment/usage-logs/${wUsageLogId}`)
      .set(auth(b.accessToken))
      .expect(404);
  });
});
