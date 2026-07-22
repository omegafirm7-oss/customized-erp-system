import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, getPrisma, setupUserWithCompany, createPartner } from "./utils/test-app";

describe("Manpower Rental (e2e)", () => {
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

  const CSV_HEADER =
    "code,nameEn,nameAr,designation,nationality,isSaudi,iqamaOrNationalId,iqamaExpiry,passportNumber,passportExpiry,gosiNumber,joinDate,contractType,bankCode,iban,costCenterCode,annualLeaveDays,basicSalary,housingAllowance,transportAllowance,otherAllowance,gosiExempt";

  /** Fresh company + customer + two employees (E1 Saudi, E2 expat) + current period. */
  async function setupManpowerContext() {
    const ctx = await setupUserWithCompany(app);
    const customer = await createPartner(app, ctx.accessToken, "CUSTOMER");
    const periodsRes = await request(app.getHttpServer())
      .get("/companies/current/fiscal-periods")
      .set(auth(ctx.accessToken))
      .expect(200);
    const now = Date.now();
    const period = periodsRes.body.find(
      (p: any) => new Date(p.startDate).getTime() <= now && now <= new Date(p.endDate).getTime(),
    );
    const joinDate = new Date(period.startDate).toISOString().slice(0, 10);
    const csv = [
      CSV_HEADER,
      `E1,Worker One,,Driver,SA,true,1011111111,2027-01-01,,,,${joinDate},UNLIMITED,80,SA01,,21,4000,1000,0,0,false`,
      `E2,Worker Two,,Helper,IN,false,2022222222,2027-01-01,,,,${joinDate},LIMITED,10,SA02,,21,3000,500,0,0,false`,
    ].join("\n");
    await request(app.getHttpServer()).post("/hr/employees/import").set(auth(ctx.accessToken)).send({ csv }).expect(201);
    const employees = (
      await request(app.getHttpServer()).get("/hr/employees").set(auth(ctx.accessToken)).expect(200)
    ).body;
    return {
      ...ctx,
      customer,
      period,
      periods: periodsRes.body,
      e1: employees.find((e: any) => e.code === "E1"),
      e2: employees.find((e: any) => e.code === "E2"),
    };
  }

  async function createContract(ctx: any, code = "MPC-1") {
    const res = await request(app.getHttpServer())
      .post("/manpower/contracts")
      .set(auth(ctx.accessToken))
      .send({
        code,
        name: "Site Crew Rental",
        businessPartnerId: ctx.customer.id,
        startDate: new Date(ctx.period.startDate).toISOString().slice(0, 10),
      })
      .expect(201);
    return res.body;
  }

  function periodDays(period: any): number {
    // endDate is 23:59:59 of the period's last day, so the raw span already
    // covers the full day count (e.g. July: 30.9999… → 31).
    const start = new Date(period.startDate);
    const end = new Date(period.endDate);
    return Math.ceil((end.getTime() - start.getTime()) / (24 * 3600 * 1000));
  }

  // Shared worked-example chain (its run in file order)
  let wctx: any;
  let wContract: any;
  let wTimesheetId: string;
  let wInvoiceId: string;
  let wAsgE1: any;
  let expectedE1Regular: number;
  let expectedE2Amount: number;

  it("creates a contract with its MPR cost center and guards overlapping assignments", async () => {
    wctx = await setupManpowerContext();
    wContract = await createContract(wctx);
    expect(wContract.costCenter.code).toBe("MPR-MPC-1");
    expect(wContract.status).toBe("ACTIVE");

    const startDate = new Date(wctx.period.startDate).toISOString().slice(0, 10);
    // E1: DAILY 200 + OT 20/h
    wAsgE1 = (
      await request(app.getHttpServer())
        .post(`/manpower/contracts/${wContract.id}/assignments`)
        .set(auth(wctx.accessToken))
        .send({ employeeId: wctx.e1.id, rateBasis: "DAILY", billRate: "200", otBillRate: "20", startDate })
        .expect(201)
    ).body;
    // E2: MONTHLY 6000, no OT billing
    await request(app.getHttpServer())
      .post(`/manpower/contracts/${wContract.id}/assignments`)
      .set(auth(wctx.accessToken))
      .send({ employeeId: wctx.e2.id, rateBasis: "MONTHLY", billRate: "6000", startDate })
      .expect(201);

    // Overlap guard
    await request(app.getHttpServer())
      .post(`/manpower/contracts/${wContract.id}/assignments`)
      .set(auth(wctx.accessToken))
      .send({ employeeId: wctx.e1.id, rateBasis: "HOURLY", billRate: "50", startDate })
      .expect(409);
  });

  it("prefills a period timesheet and records exceptions", async () => {
    const ts = (
      await request(app.getHttpServer())
        .post(`/manpower/contracts/${wContract.id}/timesheets`)
        .set(auth(wctx.accessToken))
        .send({ fiscalPeriodId: wctx.period.id })
        .expect(201)
    ).body;
    wTimesheetId = ts.id;
    const days = periodDays(wctx.period);
    expect(ts.entries).toHaveLength(days * 2); // both assignments, every day
    expect(ts.entries.every((e: any) => e.dayType === "WORKED")).toBe(true);

    // Duplicate timesheet for the same period → 409
    await request(app.getHttpServer())
      .post(`/manpower/contracts/${wContract.id}/timesheets`)
      .set(auth(wctx.accessToken))
      .send({ fiscalPeriodId: wctx.period.id })
      .expect(409);

    // Billing a DRAFT timesheet → 409
    await request(app.getHttpServer())
      .post(`/manpower/timesheets/${wTimesheetId}/generate-invoice`)
      .set(auth(wctx.accessToken))
      .expect(409);

    // E1: 4 ABSENT days + 10 OT hours on the first worked day
    const e1Entries = ts.entries.filter((e: any) => e.assignmentId === wAsgE1.id);
    for (let i = 0; i < 4; i++) {
      await request(app.getHttpServer())
        .post(`/manpower/timesheets/${wTimesheetId}/entries`)
        .set(auth(wctx.accessToken))
        .send({ assignmentId: wAsgE1.id, date: e1Entries[i].date.slice(0, 10), dayType: "ABSENT" })
        .expect(201);
    }
    await request(app.getHttpServer())
      .post(`/manpower/timesheets/${wTimesheetId}/entries`)
      .set(auth(wctx.accessToken))
      .send({ assignmentId: wAsgE1.id, date: e1Entries[5].date.slice(0, 10), dayType: "WORKED", overtimeHours: "10" })
      .expect(201);

    // E2: 2 UNPAID_LEAVE days
    const e2Asg = ts.entries.find((e: any) => e.assignmentId !== wAsgE1.id).assignmentId;
    const e2Entries = ts.entries.filter((e: any) => e.assignmentId === e2Asg);
    for (let i = 0; i < 2; i++) {
      await request(app.getHttpServer())
        .post(`/manpower/timesheets/${wTimesheetId}/entries`)
        .set(auth(wctx.accessToken))
        .send({ assignmentId: e2Asg, date: e2Entries[i].date.slice(0, 10), dayType: "UNPAID_LEAVE" })
        .expect(201);
    }

    // Entry outside the period → 400
    const outside = new Date(new Date(wctx.period.endDate).getTime() + 3 * 24 * 3600 * 1000);
    await request(app.getHttpServer())
      .post(`/manpower/timesheets/${wTimesheetId}/entries`)
      .set(auth(wctx.accessToken))
      .send({ assignmentId: wAsgE1.id, date: outside.toISOString().slice(0, 10), dayType: "WORKED" })
      .expect(400);
  });

  it("approves, locks entries and generates the invoice with exact line amounts", async () => {
    await request(app.getHttpServer())
      .post(`/manpower/timesheets/${wTimesheetId}/approve`)
      .set(auth(wctx.accessToken))
      .expect(201);

    // Locked after approval
    await request(app.getHttpServer())
      .post(`/manpower/timesheets/${wTimesheetId}/entries`)
      .set(auth(wctx.accessToken))
      .send({
        assignmentId: wAsgE1.id,
        date: new Date(wctx.period.startDate).toISOString().slice(0, 10),
        dayType: "REST",
      })
      .expect(409);

    const invoice = (
      await request(app.getHttpServer())
        .post(`/manpower/timesheets/${wTimesheetId}/generate-invoice`)
        .set(auth(wctx.accessToken))
        .expect(201)
    ).body;
    wInvoiceId = invoice.id;
    expect(invoice.status).toBe("DRAFT");

    const days = periodDays(wctx.period);
    // E1 DAILY: (days − 4 absent) × 200; OT 10 × 20 = 200
    expectedE1Regular = (days - 4) * 200;
    // E2 MONTHLY: 6000/30 × min(days − 2, 30)
    expectedE2Amount = (6000 / 30) * Math.min(days - 2, 30);

    expect(invoice.lines).toHaveLength(3);
    const amounts = invoice.lines.map((l: any) => Number(l.netAmount)).sort((a: number, b: number) => a - b);
    expect(amounts).toEqual([200, expectedE1Regular, expectedE2Amount].sort((a, b) => a - b));
    // Every line dimensioned with the contract CC and on the 4400 account
    const prisma = getPrisma(app);
    const account4400 = await prisma.account.findFirst({ where: { companyId: wctx.companyId, code: "4400" } });
    for (const line of invoice.lines) {
      expect(line.costCenterId).toBe(wContract.costCenterId);
      expect(line.revenueAccountId).toBe(account4400!.id);
    }

    // Double-bill blocked
    await request(app.getHttpServer())
      .post(`/manpower/timesheets/${wTimesheetId}/generate-invoice`)
      .set(auth(wctx.accessToken))
      .expect(409);
  });

  it("posting the invoice stamps the contract CC on the 4400 revenue legs", async () => {
    await request(app.getHttpServer())
      .post(`/ar/invoices/${wInvoiceId}/post`)
      .set(auth(wctx.accessToken))
      .expect(201);

    const prisma = getPrisma(app);
    const invoice = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: wInvoiceId } });
    const je = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: invoice.journalEntryId! },
      include: { lines: { include: { account: true } } },
    });
    const revenueLegs = je.lines.filter((l) => l.account.code === "4400");
    expect(revenueLegs.length).toBeGreaterThan(0);
    const revenueTotal = revenueLegs.reduce((acc, l) => acc + Number(l.credit), 0);
    expect(revenueTotal).toBeCloseTo(expectedE1Regular + 200 + expectedE2Amount, 2);
    expect(revenueLegs.every((l) => l.costCenterId === wContract.costCenterId)).toBe(true);
    // AR control leg undimensioned
    const arLeg = je.lines.find((l) => l.account.code === "1210");
    expect(arLeg!.costCenterId).toBeNull();
  });

  it("payroll draft prefills timesheet exceptions and carries the contract cost center", async () => {
    const run = (
      await request(app.getHttpServer())
        .post("/hr/payroll-runs")
        .set(auth(wctx.accessToken))
        .send({ fiscalPeriodId: wctx.period.id })
        .expect(201)
    ).body;

    const lineE1 = run.lines.find((l: any) => l.employee.code === "E1");
    const lineE2 = run.lines.find((l: any) => l.employee.code === "E2");
    // From the approved timesheet: E1 4 absent + 10 OT; E2 2 unpaid
    expect(Number(lineE1.absentDays)).toBe(4);
    expect(Number(lineE1.overtimeHours)).toBe(10);
    expect(Number(lineE2.unpaidDays)).toBe(2);
    // Both employees' cost lands on the contract's cost center
    expect(lineE1.costCenter.code).toBe("MPR-MPC-1");
    expect(lineE2.costCenter.code).toBe("MPR-MPC-1");

    // Post and verify profitability = billed − labor from the GL
    await request(app.getHttpServer())
      .post(`/hr/payroll-runs/${run.id}/post`)
      .set(auth(wctx.accessToken))
      .expect(201);

    const report = (
      await request(app.getHttpServer())
        .get("/manpower/reports/contract-profitability")
        .set(auth(wctx.accessToken))
        .expect(200)
    ).body;
    const row = report.find((r: any) => r.code === "MPC-1");
    const billed = expectedE1Regular + 200 + expectedE2Amount;
    expect(Number(row.billed)).toBeCloseTo(billed, 2);
    expect(Number(row.laborCost)).toBeGreaterThan(0);
    expect(Number(row.margin)).toBeCloseTo(billed - Number(row.laborCost), 2);
  });

  it("cancel-invoice → reopen → re-bill works; closing blocks while un-invoiced timesheets exist", async () => {
    // Cancel the posted invoice, reopen the timesheet, re-generate
    await request(app.getHttpServer())
      .post(`/ar/invoices/${wInvoiceId}/cancel`)
      .set(auth(wctx.accessToken))
      .expect(201);
    const reopened = (
      await request(app.getHttpServer())
        .post(`/manpower/timesheets/${wTimesheetId}/reopen`)
        .set(auth(wctx.accessToken))
        .expect(201)
    ).body;
    expect(reopened.status).toBe("APPROVED");

    // Closing now blocked (APPROVED un-invoiced timesheet)
    await request(app.getHttpServer())
      .post(`/manpower/contracts/${wContract.id}/close`)
      .set(auth(wctx.accessToken))
      .expect(409);

    const invoice2 = (
      await request(app.getHttpServer())
        .post(`/manpower/timesheets/${wTimesheetId}/generate-invoice`)
        .set(auth(wctx.accessToken))
        .expect(201)
    ).body;
    expect(invoice2.id).not.toBe(wInvoiceId);

    // Now closing succeeds and deactivates the cost center
    const closed = (
      await request(app.getHttpServer())
        .post(`/manpower/contracts/${wContract.id}/close`)
        .set(auth(wctx.accessToken))
        .expect(201)
    ).body;
    expect(closed.status).toBe("CLOSED");
    const prisma = getPrisma(app);
    const cc = await prisma.costCenter.findUniqueOrThrow({ where: { id: wContract.costCenterId } });
    expect(cc.isActive).toBe(false);
  });

  it("isolates manpower data between companies", async () => {
    const b = await setupUserWithCompany(app);
    const contracts = (
      await request(app.getHttpServer()).get("/manpower/contracts").set(auth(b.accessToken)).expect(200)
    ).body;
    expect(contracts).toHaveLength(0);
    // Foreign timesheet not reachable
    await request(app.getHttpServer())
      .get(`/manpower/timesheets/${wTimesheetId}`)
      .set(auth(b.accessToken))
      .expect(404);
  });
});
