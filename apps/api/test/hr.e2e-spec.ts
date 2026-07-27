import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, getPrisma, setupUserWithCompany } from "./utils/test-app";

describe("HR & Saudi Payroll (e2e)", () => {
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
    expect(period).toBeDefined();
    return { period, periods: res.body };
  }

  const CSV_HEADER =
    "code,nameEn,nameAr,designation,nationality,isSaudi,iqamaOrNationalId,iqamaExpiry,passportNumber,passportExpiry,gosiNumber,joinDate,contractType,bankCode,iban,costCenterCode,annualLeaveDays,basicSalary,housingAllowance,transportAllowance,otherAllowance,gosiExempt";

  /** Imports the worked-example pair: Saudi A (10k/2.5k/1k) + expat B (8k/2k). */
  async function importWorkedExamplePair(ctx: any, joinDate: string, ccCode: string) {
    const csv = [
      CSV_HEADER,
      `EMPA,Ahmed Ali,,Foreman,SA,true,1012345678,2027-06-30,,,50012345,${joinDate},UNLIMITED,80,SA4420000001234567891234,${ccCode},21,10000,2500,1000,0,false`,
      `EMPB,John Perera,,Mason,LK,false,2298765432,2026-12-31,,,,${joinDate},LIMITED,10,SA0380000000608010167519,,21,8000,2000,0,0,false`,
    ].join("\n");
    const res = await request(app.getHttpServer())
      .post("/hr/employees/import")
      .set(auth(ctx.accessToken))
      .send({ csv })
      .expect(201);
    expect(res.body.imported).toBe(2);
    expect(res.body.errors).toHaveLength(0);
    const employees = (
      await request(app.getHttpServer()).get("/hr/employees").set(auth(ctx.accessToken)).expect(200)
    ).body;
    return {
      empA: employees.find((e: any) => e.code === "EMPA"),
      empB: employees.find((e: any) => e.code === "EMPB"),
    };
  }

  it("provisions default statutory rates and audits settings changes", async () => {
    const ctx = await setupUserWithCompany(app);
    const settings = (
      await request(app.getHttpServer()).get("/hr/settings").set(auth(ctx.accessToken)).expect(200)
    ).body;
    expect(Number(settings.saudiEmployeeRatePct)).toBe(9.75);
    expect(Number(settings.saudiEmployerRatePct)).toBe(11.75);
    expect(Number(settings.expatEmployerRatePct)).toBe(2);
    expect(Number(settings.gosiWageCap)).toBe(45000);
    expect(settings.eosbBasis).toBe("FULL_GROSS");

    const updated = (
      await request(app.getHttpServer())
        .patch("/hr/settings")
        .set(auth(ctx.accessToken))
        .send({ molEstablishmentId: "MOL-1", employerBankCode: "80", employerIban: "SA000011112222" })
        .expect(200)
    ).body;
    expect(updated.molEstablishmentId).toBe("MOL-1");
  });

  it("serves the CSV template and rejects invalid import rows with row numbers", async () => {
    const ctx = await setupUserWithCompany(app);

    const template = await request(app.getHttpServer())
      .get("/hr/employees/import/template")
      .set(auth(ctx.accessToken))
      .expect(200);
    expect(template.text.split(/\r?\n/)[0]).toBe(CSV_HEADER);

    const bad = [
      CSV_HEADER,
      // missing nameEn, invalid joinDate
      "EMPX,,,,SA,true,,,,,,not-a-date,UNLIMITED,,,,21,1000,0,0,0,false",
      // duplicate code within file
      "EMPY,Someone,,,SA,true,,,,,,2026-01-01,UNLIMITED,,,,21,1000,0,0,0,false",
      "EMPY,Someone Else,,,SA,true,,,,,,2026-01-01,UNLIMITED,,,,21,1000,0,0,0,false",
    ].join("\n");
    const res = await request(app.getHttpServer())
      .post("/hr/employees/import")
      .set(auth(ctx.accessToken))
      .send({ csv: bad })
      .expect(201);
    expect(res.body.imported).toBe(0);
    expect(res.body.errors.some((e: any) => e.row === 2 && /nameEn/.test(e.message))).toBe(true);
    expect(res.body.errors.some((e: any) => e.row === 2 && /joinDate/.test(e.message))).toBe(true);
    expect(res.body.errors.some((e: any) => e.row === 4 && /Duplicate/.test(e.message))).toBe(true);

    // Nothing was persisted
    const employees = (
      await request(app.getHttpServer()).get("/hr/employees").set(auth(ctx.accessToken)).expect(200)
    ).body;
    expect(employees).toHaveLength(0);
  });

  // Shared across the worked-example chain below (jest runs its sequentially)
  let wctx: any;
  let wPeriod: any;
  let wPeriods: any[];
  let wEmpA: any;
  let wRunId: string;

  it("worked example: draft run computes GOSI, loans, EOSB and leave exactly", async () => {
    wctx = await setupUserWithCompany(app);
    const { period, periods } = await currentPeriod(wctx);
    wPeriod = period;
    wPeriods = periods;
    const joinDate = new Date(period.startDate).toISOString().slice(0, 10);

    // WPS employer identifiers (needed later for the SIF file)
    await request(app.getHttpServer())
      .patch("/hr/settings")
      .set(auth(wctx.accessToken))
      .send({ molEstablishmentId: "1234567", employerBankCode: "80", employerIban: "SA9880000000000000000001" })
      .expect(200);

    // Department cost center for employee A's dimension
    const cc = (
      await request(app.getHttpServer())
        .post("/cost-centers")
        .set(auth(wctx.accessToken))
        .send({ code: "ADMIN", name: "Administration" })
        .expect(201)
    ).body;

    const pair = await importWorkedExamplePair(wctx, joinDate, "ADMIN");
    wEmpA = pair.empA;
    expect(pair.empB).toBeDefined();
    expect(wEmpA.costCenter.code).toBe("ADMIN");
    expect(cc.id).toBeDefined();

    // 6,000 loan @ 1,000/month to A, paid from petty cash
    const loan = (
      await request(app.getHttpServer())
        .post(`/hr/employees/${wEmpA.id}/loans`)
        .set(auth(wctx.accessToken))
        .send({ principal: "6000", monthlyInstallment: "1000", disbursementAccountId: wctx.cashAccount.id })
        .expect(201)
    ).body;
    expect(loan.loanNumber).toMatch(/^LOAN-/);
    expect(Number(loan.balance)).toBe(6000);

    // Loan disbursement JE: Dr 1160 / Cr 1110
    const prisma = getPrisma(app);
    const loanJe = await prisma.journalEntry.findFirst({
      where: { companyId: wctx.companyId, sourceDocumentId: loan.id },
      include: { lines: { include: { account: true } } },
    });
    expect(loanJe).not.toBeNull();
    expect(loanJe!.lines.find((l) => l.account.code === "1160")!.debit.toString()).toBe("6000");
    expect(loanJe!.lines.find((l) => l.account.code === "1110")!.credit.toString()).toBe("6000");

    // Draft run
    const run = (
      await request(app.getHttpServer())
        .post("/hr/payroll-runs")
        .set(auth(wctx.accessToken))
        .send({ fiscalPeriodId: period.id })
        .expect(201)
    ).body;
    wRunId = run.id;
    expect(run.status).toBe("DRAFT");
    expect(run.lines).toHaveLength(2);

    const lineA = run.lines.find((l: any) => l.employee.code === "EMPA");
    const lineB = run.lines.find((l: any) => l.employee.code === "EMPB");
    // Saudi A: base 12,500 → 1,218.75 / 1,468.75; loan 1,000
    expect(Number(lineA.gosiBase)).toBe(12500);
    expect(Number(lineA.gosiEmployee)).toBe(1218.75);
    expect(Number(lineA.gosiEmployer)).toBe(1468.75);
    expect(Number(lineA.loanDeduction)).toBe(1000);
    expect(Number(lineA.grossPay)).toBe(13500);
    expect(Number(lineA.netPay)).toBe(11281.25);
    // First-month EOSB (full gross 13,500): 562.50; leave 1.75d = 787.50
    expect(Number(lineA.eosbDelta)).toBe(562.5);
    expect(Number(lineA.leaveBalanceDays)).toBe(1.75);
    expect(Number(lineA.leaveDelta)).toBe(787.5);
    // Expat B: employer-only 2% of 10,000
    expect(Number(lineB.gosiEmployee)).toBe(0);
    expect(Number(lineB.gosiEmployer)).toBe(200);
    expect(Number(lineB.eosbDelta)).toBe(416.67);
    expect(Number(lineB.leaveDelta)).toBe(583.33);
  });

  it("worked example: exceptions recompute the line (2 unpaid days + 10 OT hours)", async () => {
    const run = (
      await request(app.getHttpServer()).get(`/hr/payroll-runs/${wRunId}`).set(auth(wctx.accessToken)).expect(200)
    ).body;
    const lineA = run.lines.find((l: any) => l.employee.code === "EMPA");

    const updated = (
      await request(app.getHttpServer())
        .patch(`/hr/payroll-runs/${wRunId}/lines/${lineA.id}`)
        .set(auth(wctx.accessToken))
        .send({ unpaidDays: "2", overtimeHours: "10" })
        .expect(200)
    ).body;
    const newA = updated.lines.find((l: any) => l.employee.code === "EMPA");
    expect(Number(newA.absenceDeduction)).toBe(900);
    expect(Number(newA.overtimePay)).toBe(625);
    expect(Number(newA.grossPay)).toBe(13225);
    expect(Number(newA.netPay)).toBe(11006.25);
    // Totals refreshed: A 11,006.25 + B 10,000
    expect(Number(updated.totalNetPay)).toBe(21006.25);
  });

  it("worked example: posting builds one balanced JE with dims on expense legs only", async () => {
    const posted = (
      await request(app.getHttpServer())
        .post(`/hr/payroll-runs/${wRunId}/post`)
        .set(auth(wctx.accessToken))
        .expect(201)
    ).body;
    expect(posted.status).toBe("POSTED");
    expect(posted.runNumber).toMatch(/^PYR-/);

    const prisma = getPrisma(app);
    const je = await prisma.journalEntry.findFirst({
      where: { companyId: wctx.companyId, sourceDocumentId: wRunId },
      include: { lines: { include: { account: true, costCenter: true } } },
    });
    expect(je).not.toBeNull();
    const byCode = (code: string) => je!.lines.filter((l) => l.account.code === code);

    // 5200: ADMIN-dimensioned 13,225 (A) + undimensioned 10,000 (B)
    const salaryLegs = byCode("5200");
    expect(salaryLegs).toHaveLength(2);
    const adminLeg = salaryLegs.find((l) => l.costCenter?.code === "ADMIN")!;
    const noCcLeg = salaryLegs.find((l) => !l.costCenterId)!;
    expect(adminLeg.debit.toString()).toBe("13225");
    expect(noCcLeg.debit.toString()).toBe("10000");

    // Employer GOSI expense 1,468.75 (ADMIN) + 200 (no CC)
    const gosiLegs = byCode("5250");
    expect(gosiLegs.find((l) => l.costCenter?.code === "ADMIN")!.debit.toString()).toBe("1468.75");
    expect(gosiLegs.find((l) => !l.costCenterId)!.debit.toString()).toBe("200");

    // Control legs: undimensioned exact totals
    const sum = (code: string, side: "debit" | "credit") =>
      byCode(code).reduce((acc, l) => acc + Number(l[side]), 0);
    expect(sum("2320", "credit")).toBe(2887.5); // 1218.75 + 1468.75 + 200
    expect(sum("1160", "credit")).toBe(1000);
    expect(sum("2520", "credit")).toBeCloseTo(979.17, 2); // 562.50 + 416.67
    expect(sum("2340", "credit")).toBeCloseTo(1370.83, 2); // 787.50 + 583.33
    expect(sum("2310", "credit")).toBe(21006.25);
    for (const code of ["2320", "1160", "2520", "2340", "2310"]) {
      expect(byCode(code).every((l) => !l.costCenterId)).toBe(true);
    }

    // Entry balances
    const totalDr = je!.lines.reduce((acc, l) => acc + Number(l.debit), 0);
    const totalCr = je!.lines.reduce((acc, l) => acc + Number(l.credit), 0);
    expect(totalDr).toBeCloseTo(totalCr, 2);

    // Loan decremented
    const loans = (
      await request(app.getHttpServer())
        .get(`/hr/loans?employeeId=${wEmpA.id}`)
        .set(auth(wctx.accessToken))
        .expect(200)
    ).body;
    expect(Number(loans[0].balance)).toBe(5000);
  });

  it("worked example: WPS SIF reconciles and the GOSI summary matches", async () => {
    const wps = await request(app.getHttpServer())
      .get(`/hr/payroll-runs/${wRunId}/wps-file`)
      .set(auth(wctx.accessToken))
      .expect(200);
    const rows = wps.text.trim().split(/\r?\n/);
    expect(rows[0]).toContain("EMPLOYER,1234567,80,SA9880000000000000000001");
    expect(rows[0]).toContain("21006.25");
    expect(rows).toHaveLength(3);
    const rowA = rows.find((r) => r.startsWith("EMPLOYEE,EMPA"))!;
    expect(rowA).toContain("11006.25");
    expect(rowA).toContain("SA4420000001234567891234");

    const gosi = (
      await request(app.getHttpServer())
        .get(`/hr/reports/gosi-summary?fiscalPeriodId=${wPeriod.id}`)
        .set(auth(wctx.accessToken))
        .expect(200)
    ).body;
    expect(Number(gosi.totals.employeeShare)).toBe(1218.75);
    expect(Number(gosi.totals.employerShare)).toBe(1668.75);
  });

  it("worked example: period guard, next-period EOSB chaining, reverse restores loans", async () => {
    // Second run for the same period → 409
    await request(app.getHttpServer())
      .post("/hr/payroll-runs")
      .set(auth(wctx.accessToken))
      .send({ fiscalPeriodId: wPeriod.id })
      .expect(409);

    // Next-period draft: EOSB delta chains (entitlement 2 months − month 1)
    const nextPeriod = wPeriods.find((p: any) => p.periodNumber === wPeriod.periodNumber + 1);
    expect(nextPeriod).toBeDefined();
    const nextDraft = (
      await request(app.getHttpServer())
        .post("/hr/payroll-runs")
        .set(auth(wctx.accessToken))
        .send({ fiscalPeriodId: nextPeriod.id })
        .expect(201)
    ).body;
    const nextA = nextDraft.lines.find((l: any) => l.employee.code === "EMPA");
    expect(Number(nextA.eosbDelta)).toBe(562.5); // 1,125 to date − 562.50 booked
    expect(Number(nextA.loanDeduction)).toBe(1000); // balance 5,000 continues

    // Reversing month 1 while a later run is only DRAFT is allowed
    await request(app.getHttpServer())
      .delete(`/hr/payroll-runs/${nextDraft.id}`)
      .set(auth(wctx.accessToken))
      .expect(200);
    const reversed = (
      await request(app.getHttpServer())
        .post(`/hr/payroll-runs/${wRunId}/reverse`)
        .set(auth(wctx.accessToken))
        .expect(201)
    ).body;
    expect(reversed.status).toBe("REVERSED");

    const loans = (
      await request(app.getHttpServer())
        .get(`/hr/loans?employeeId=${wEmpA.id}`)
        .set(auth(wctx.accessToken))
        .expect(200)
    ).body;
    expect(Number(loans[0].balance)).toBe(6000);

    // Period is free again after the reversal
    const rerun = (
      await request(app.getHttpServer())
        .post("/hr/payroll-runs")
        .set(auth(wctx.accessToken))
        .send({ fiscalPeriodId: wPeriod.id })
        .expect(201)
    ).body;
    expect(rerun.status).toBe("DRAFT");
    // EOSB delta is back to the month-1 value (reversed run excluded from sums)
    const rerunA = rerun.lines.find((l: any) => l.employee.code === "EMPA");
    expect(Number(rerunA.eosbDelta)).toBe(562.5);
  });

  it("termination settlement clears provisions, recovers loans and excludes the employee", async () => {
    const ctx = await setupUserWithCompany(app);
    const { period } = await currentPeriod(ctx);
    const joinDate = new Date(period.startDate).toISOString().slice(0, 10);

    const csv = [
      CSV_HEADER,
      `EMPT,Tariq Khan,,Steel Fixer,PK,false,3312345678,2027-01-01,,,,${joinDate},LIMITED,10,SA1122334455667788990011,,21,9000,3000,0,0,false`,
    ].join("\n");
    await request(app.getHttpServer()).post("/hr/employees/import").set(auth(ctx.accessToken)).send({ csv }).expect(201);
    const employee = (
      await request(app.getHttpServer()).get("/hr/employees").set(auth(ctx.accessToken)).expect(200)
    ).body[0];

    // Post month-1 payroll: EOSB 500, leave 700 for gross 12,000
    const run = (
      await request(app.getHttpServer())
        .post("/hr/payroll-runs")
        .set(auth(ctx.accessToken))
        .send({ fiscalPeriodId: period.id })
        .expect(201)
    ).body;
    await request(app.getHttpServer()).post(`/hr/payroll-runs/${run.id}/post`).set(auth(ctx.accessToken)).expect(201);

    // Preview at period end, employer-initiated → full EOSB
    const lastWorkingDay = new Date(period.endDate).toISOString().slice(0, 10);
    const preview = (
      await request(app.getHttpServer())
        .post(`/hr/employees/${employee.id}/termination/preview`)
        .set(auth(ctx.accessToken))
        .send({ reason: "TERMINATION_BY_EMPLOYER", lastWorkingDay })
        .expect(201)
    ).body;
    expect(Number(preview.eosbAmount)).toBe(500);
    expect(Number(preview.leavePayoutAmount)).toBe(700);
    expect(Number(preview.loanRecovery)).toBe(0);
    expect(Number(preview.netAmount)).toBe(1200);

    const settlement = (
      await request(app.getHttpServer())
        .post(`/hr/employees/${employee.id}/termination`)
        .set(auth(ctx.accessToken))
        .send({ reason: "TERMINATION_BY_EMPLOYER", lastWorkingDay })
        .expect(201)
    ).body;
    expect(settlement.settlementNumber).toMatch(/^FS-/);
    expect(Number(settlement.netAmount)).toBe(1200);

    // Settlement JE clears both provisions in full (no catch-up gap here)
    const prisma = getPrisma(app);
    const je = await prisma.journalEntry.findFirst({
      where: { companyId: ctx.companyId, sourceDocumentId: settlement.id },
      include: { lines: { include: { account: true } } },
    });
    const leg = (code: string) => je!.lines.find((l) => l.account.code === code);
    expect(leg("2520")!.debit.toString()).toBe("500");
    expect(leg("2340")!.debit.toString()).toBe("700");
    expect(leg("2310")!.credit.toString()).toBe("1200");

    // Employee is TERMINATED and future runs have nobody to pay
    const after = (
      await request(app.getHttpServer()).get(`/hr/employees/${employee.id}`).set(auth(ctx.accessToken)).expect(200)
    ).body;
    expect(after.status).toBe("TERMINATED");
    await request(app.getHttpServer())
      .post("/hr/payroll-runs")
      .set(auth(ctx.accessToken))
      .send({ fiscalPeriodId: period.id })
      .expect(409); // posted run still exists for the period
  });

  it("isolates HR data between companies and keeps Viewer without HR grants", async () => {
    const a = await setupUserWithCompany(app);
    const { period } = await currentPeriod(a);
    const joinDate = new Date(period.startDate).toISOString().slice(0, 10);
    const csv = [
      CSV_HEADER,
      `EMPI,Iso Test,,Laborer,SA,true,,,,,,${joinDate},UNLIMITED,,,,21,5000,0,0,0,false`,
    ].join("\n");
    await request(app.getHttpServer()).post("/hr/employees/import").set(auth(a.accessToken)).send({ csv }).expect(201);

    const b = await setupUserWithCompany(app);
    const bEmployees = (
      await request(app.getHttpServer()).get("/hr/employees").set(auth(b.accessToken)).expect(200)
    ).body;
    expect(bEmployees).toHaveLength(0);

    // Viewer system role carries no hr.* permission grants
    const prisma = getPrisma(app);
    const viewerRole = await prisma.role.findFirst({
      where: { companyId: a.companyId, name: "Viewer" },
      include: { rolePermissions: { include: { permission: true } } },
    });
    expect(viewerRole).not.toBeNull();
    expect(viewerRole!.rolePermissions.some((rp) => rp.permission.key.startsWith("hr."))).toBe(false);
  });

  it("deletes a clean employee but blocks deletion once payroll history exists", async () => {
    const ctx = await setupUserWithCompany(app);
    const { period } = await currentPeriod(ctx);
    const joinDate = new Date(period.startDate).toISOString().slice(0, 10);
    const csv = [
      CSV_HEADER,
      `EMPD1,Delete Me,,Helper,SA,true,,,,,,${joinDate},UNLIMITED,,,,21,4000,0,0,0,false`,
      `EMPD2,Keep History,,Helper,SA,true,,,,,,${joinDate},UNLIMITED,,,,21,4000,0,0,0,false`,
    ].join("\n");
    await request(app.getHttpServer()).post("/hr/employees/import").set(auth(ctx.accessToken)).send({ csv }).expect(201);
    const employees = (
      await request(app.getHttpServer()).get("/hr/employees").set(auth(ctx.accessToken)).expect(200)
    ).body;
    const empD1 = employees.find((e: any) => e.code === "EMPD1");
    const empD2 = employees.find((e: any) => e.code === "EMPD2");

    // Clean employee — no history — deletes fine
    await request(app.getHttpServer()).delete(`/hr/employees/${empD1.id}`).set(auth(ctx.accessToken)).expect(200);
    await request(app.getHttpServer()).get(`/hr/employees/${empD1.id}`).set(auth(ctx.accessToken)).expect(404);

    // Give EMPD2 payroll history, then deletion is blocked
    const run = (
      await request(app.getHttpServer())
        .post("/hr/payroll-runs")
        .set(auth(ctx.accessToken))
        .send({ fiscalPeriodId: period.id })
        .expect(201)
    ).body;
    await request(app.getHttpServer()).post(`/hr/payroll-runs/${run.id}/post`).set(auth(ctx.accessToken)).expect(201);
    await request(app.getHttpServer()).delete(`/hr/employees/${empD2.id}`).set(auth(ctx.accessToken)).expect(409);
  });

  it("records settlement payments down to zero pending, rejects overpayment, and blocks reversal once paid", async () => {
    const ctx = await setupUserWithCompany(app);
    const { period } = await currentPeriod(ctx);
    const joinDate = new Date(period.startDate).toISOString().slice(0, 10);
    const csv = [CSV_HEADER, `EMPP,Pay Me,,Helper,SA,true,,,,,,${joinDate},UNLIMITED,,,,21,6000,0,0,0,false`].join("\n");
    await request(app.getHttpServer()).post("/hr/employees/import").set(auth(ctx.accessToken)).send({ csv }).expect(201);
    const employee = (
      await request(app.getHttpServer()).get("/hr/employees").set(auth(ctx.accessToken)).expect(200)
    ).body[0];

    const lastWorkingDay = new Date(period.endDate).toISOString().slice(0, 10);
    const settlement = (
      await request(app.getHttpServer())
        .post(`/hr/employees/${employee.id}/termination`)
        .set(auth(ctx.accessToken))
        .send({ reason: "TERMINATION_BY_EMPLOYER", lastWorkingDay })
        .expect(201)
    ).body;
    const net = Number(settlement.netAmount);
    expect(net).toBeGreaterThan(0);

    // Overpayment rejected
    await request(app.getHttpServer())
      .post(`/hr/employees/${employee.id}/release/payments`)
      .set(auth(ctx.accessToken))
      .send({ amount: (net + 1).toString(), bankCashAccountId: ctx.cashAccount.id })
      .expect(400);

    // First partial payment
    const half = (net / 2).toFixed(2);
    const afterFirst = (
      await request(app.getHttpServer())
        .post(`/hr/employees/${employee.id}/release/payments`)
        .set(auth(ctx.accessToken))
        .send({ amount: half, bankCashAccountId: ctx.cashAccount.id, memo: "Partial payout" })
        .expect(201)
    ).body;
    expect(Number(afterFirst.paidAmount)).toBeCloseTo(Number(half), 2);
    expect(afterFirst.payments).toHaveLength(1);

    // Verify the JE: Dr 2310 / Cr cash
    const prisma = getPrisma(app);
    const payment1 = afterFirst.payments[0];
    const je1 = await prisma.settlementPayment.findUniqueOrThrow({
      where: { id: payment1.id },
      include: { journalEntry: { include: { lines: { include: { account: true } } } } },
    });
    const leg1 = (code: string) => je1.journalEntry.lines.find((l) => l.account.code === code)!;
    expect(Number(leg1("2310").debit)).toBeCloseTo(Number(half), 2);
    expect(Number(leg1("1110").credit)).toBeCloseTo(Number(half), 2);

    // Reversal blocked once a payment exists
    await request(app.getHttpServer())
      .post(`/hr/settlements/${settlement.id}/reverse`)
      .set(auth(ctx.accessToken))
      .expect(409);

    // Final payment brings pending to exactly zero
    const remaining = (net - Number(half)).toFixed(2);
    const afterFinal = (
      await request(app.getHttpServer())
        .post(`/hr/employees/${employee.id}/release/payments`)
        .set(auth(ctx.accessToken))
        .send({ amount: remaining, bankCashAccountId: ctx.cashAccount.id })
        .expect(201)
    ).body;
    expect(Number(afterFinal.paidAmount)).toBeCloseTo(net, 2);

    // Nothing left to pay
    await request(app.getHttpServer())
      .post(`/hr/employees/${employee.id}/release/payments`)
      .set(auth(ctx.accessToken))
      .send({ amount: "0.01", bankCashAccountId: ctx.cashAccount.id })
      .expect(400);
  });

  it("allows releasing an employee again after a reversal, with fresh settlement figures", async () => {
    const ctx = await setupUserWithCompany(app);
    const { period } = await currentPeriod(ctx);
    const joinDate = new Date(period.startDate).toISOString().slice(0, 10);
    const csv = [CSV_HEADER, `EMPR,Re Lease,,Helper,SA,true,,,,,,${joinDate},UNLIMITED,,,,21,7000,0,0,0,false`].join(
      "\n",
    );
    await request(app.getHttpServer()).post("/hr/employees/import").set(auth(ctx.accessToken)).send({ csv }).expect(201);
    const employee = (
      await request(app.getHttpServer()).get("/hr/employees").set(auth(ctx.accessToken)).expect(200)
    ).body[0];

    const lastWorkingDay = new Date(period.endDate).toISOString().slice(0, 10);
    const firstSettlement = (
      await request(app.getHttpServer())
        .post(`/hr/employees/${employee.id}/termination`)
        .set(auth(ctx.accessToken))
        .send({ reason: "TERMINATION_BY_EMPLOYER", lastWorkingDay })
        .expect(201)
    ).body;
    expect(Number(firstSettlement.netAmount)).toBeGreaterThan(0);

    const afterFirstRelease = (
      await request(app.getHttpServer()).get(`/hr/employees/${employee.id}`).set(auth(ctx.accessToken)).expect(200)
    ).body;
    expect(afterFirstRelease.status).toBe("TERMINATED");

    // No payments recorded yet, so reversal is allowed
    await request(app.getHttpServer())
      .post(`/hr/settlements/${firstSettlement.id}/reverse`)
      .set(auth(ctx.accessToken))
      .expect(201);

    const afterReversal = (
      await request(app.getHttpServer()).get(`/hr/employees/${employee.id}`).set(auth(ctx.accessToken)).expect(200)
    ).body;
    expect(afterReversal.status).toBe("ACTIVE");

    // A REVERSED settlement must not count as pending — it left a row
    // behind (reused, not deleted) but carries no real debt
    const summaryAfterReversal = (
      await request(app.getHttpServer())
        .get(`/hr/employees/${employee.id}/summary`)
        .set(auth(ctx.accessToken))
        .expect(200)
    ).body;
    expect(Number(summaryAfterReversal.settlementPending)).toBe(0);
    expect(Number(summaryAfterReversal.totalPending)).toBe(0);

    // Releasing the same employee a second time must not hit the
    // FinalSettlement.employeeId unique constraint from the reversed row
    const secondSettlement = (
      await request(app.getHttpServer())
        .post(`/hr/employees/${employee.id}/termination`)
        .set(auth(ctx.accessToken))
        .send({ reason: "RESIGNATION", lastWorkingDay })
        .expect(201)
    ).body;
    expect(secondSettlement.id).toBe(firstSettlement.id); // row reused, not a new one
    expect(secondSettlement.status).toBe("POSTED");
    expect(Number(secondSettlement.paidAmount)).toBe(0);
    expect(secondSettlement.reason).toBe("RESIGNATION");

    const afterSecondRelease = (
      await request(app.getHttpServer()).get(`/hr/employees/${employee.id}`).set(auth(ctx.accessToken)).expect(200)
    ).body;
    expect(afterSecondRelease.status).toBe("TERMINATED");

    // Fully payable again from scratch
    const payment = (
      await request(app.getHttpServer())
        .post(`/hr/employees/${employee.id}/release/payments`)
        .set(auth(ctx.accessToken))
        .send({ amount: secondSettlement.netAmount, bankCashAccountId: ctx.cashAccount.id })
        .expect(201)
    ).body;
    expect(Number(payment.paidAmount)).toBeCloseTo(Number(secondSettlement.netAmount), 2);
  });

  it("employee-timesheet entry upsert persists, is idempotent, rejects out-of-range hours, and prefill fills only missing days", async () => {
    const ctx = await setupUserWithCompany(app);
    const { period } = await currentPeriod(ctx);
    const joinDate = new Date(period.startDate).toISOString().slice(0, 10);
    const csv = [CSV_HEADER, `EMPU,Attend Me,,Helper,SA,true,,,,,,${joinDate},UNLIMITED,,,,21,5000,0,0,0,false`].join(
      "\n",
    );
    await request(app.getHttpServer()).post("/hr/employees/import").set(auth(ctx.accessToken)).send({ csv }).expect(201);
    const employee = (
      await request(app.getHttpServer()).get("/hr/employees").set(auth(ctx.accessToken)).expect(200)
    ).body[0];

    const initial = (
      await request(app.getHttpServer())
        .get(`/hr/employee-timesheet?fiscalPeriodId=${period.id}`)
        .set(auth(ctx.accessToken))
        .expect(200)
    ).body;
    expect(initial.employees.find((e: any) => e.employeeId === employee.id).entries).toHaveLength(0);

    await request(app.getHttpServer())
      .post("/hr/employee-timesheet/entry")
      .set(auth(ctx.accessToken))
      .send({ employeeId: employee.id, date: joinDate, dayType: "WORKED", hoursWorked: "8" })
      .expect(201);
    const afterFirst = (
      await request(app.getHttpServer())
        .get(`/hr/employee-timesheet?fiscalPeriodId=${period.id}`)
        .set(auth(ctx.accessToken))
        .expect(200)
    ).body;
    const entriesAfterFirst = afterFirst.employees.find((e: any) => e.employeeId === employee.id).entries;
    expect(entriesAfterFirst).toHaveLength(1);
    expect(Number(entriesAfterFirst[0].hoursWorked)).toBe(8);

    // Same employee/date — upsert, not duplicate; dayType change with no
    // explicit hours defaults to 0 for a non-WORKED day
    await request(app.getHttpServer())
      .post("/hr/employee-timesheet/entry")
      .set(auth(ctx.accessToken))
      .send({ employeeId: employee.id, date: joinDate, dayType: "REST" })
      .expect(201);
    const afterRest = (
      await request(app.getHttpServer())
        .get(`/hr/employee-timesheet?fiscalPeriodId=${period.id}`)
        .set(auth(ctx.accessToken))
        .expect(200)
    ).body;
    const entriesAfterRest = afterRest.employees.find((e: any) => e.employeeId === employee.id).entries;
    expect(entriesAfterRest).toHaveLength(1);
    expect(entriesAfterRest[0].dayType).toBe("REST");
    expect(Number(entriesAfterRest[0].hoursWorked)).toBe(0);

    // Out-of-range rejected
    await request(app.getHttpServer())
      .post("/hr/employee-timesheet/entry")
      .set(auth(ctx.accessToken))
      .send({ employeeId: employee.id, date: joinDate, dayType: "WORKED", hoursWorked: "30" })
      .expect(400);

    // Prefill fills every other day of the period but leaves the REST day untouched
    await request(app.getHttpServer())
      .post("/hr/employee-timesheet/prefill")
      .set(auth(ctx.accessToken))
      .send({ fiscalPeriodId: period.id })
      .expect(201);
    const afterPrefill = (
      await request(app.getHttpServer())
        .get(`/hr/employee-timesheet?fiscalPeriodId=${period.id}`)
        .set(auth(ctx.accessToken))
        .expect(200)
    ).body;
    const entriesAfterPrefill = afterPrefill.employees.find((e: any) => e.employeeId === employee.id).entries;
    expect(entriesAfterPrefill.length).toBeGreaterThan(1);
    const preservedRestDay = entriesAfterPrefill.find((e: any) => e.date.slice(0, 10) === joinDate);
    expect(preservedRestDay.dayType).toBe("REST");
    expect(Number(preservedRestDay.hoursWorked)).toBe(0);
    const otherDay = entriesAfterPrefill.find((e: any) => e.date.slice(0, 10) !== joinDate);
    expect(otherDay.dayType).toBe("WORKED");
    expect(Number(otherDay.hoursWorked)).toBe(0);
  });

  it("employee-timesheet reset-hours zeroes hours in a period without changing dayType", async () => {
    const ctx = await setupUserWithCompany(app);
    const { period } = await currentPeriod(ctx);
    const joinDate = new Date(period.startDate).toISOString().slice(0, 10);
    const csv = [CSV_HEADER, `EMPZ,Zero Me,,Helper,SA,true,,,,,,${joinDate},UNLIMITED,,,,21,4000,0,0,0,false`].join("\n");
    await request(app.getHttpServer()).post("/hr/employees/import").set(auth(ctx.accessToken)).send({ csv }).expect(201);
    const employee = (
      await request(app.getHttpServer()).get("/hr/employees").set(auth(ctx.accessToken)).expect(200)
    ).body[0];

    await request(app.getHttpServer())
      .post("/hr/employee-timesheet/entry")
      .set(auth(ctx.accessToken))
      .send({ employeeId: employee.id, date: joinDate, dayType: "WORKED", hoursWorked: "8" })
      .expect(201);

    await request(app.getHttpServer())
      .post("/hr/employee-timesheet/reset-hours")
      .set(auth(ctx.accessToken))
      .send({ fiscalPeriodId: period.id })
      .expect(201);

    const afterReset = (
      await request(app.getHttpServer())
        .get(`/hr/employee-timesheet?fiscalPeriodId=${period.id}`)
        .set(auth(ctx.accessToken))
        .expect(200)
    ).body;
    const entry = afterReset.employees.find((e: any) => e.employeeId === employee.id).entries[0];
    expect(entry.dayType).toBe("WORKED");
    expect(Number(entry.hoursWorked)).toBe(0);
  });

  it("employee-timesheet manual edit defaults WORKED to 10 hours but REST/ABSENT stay at 0 when hours are omitted", async () => {
    const ctx = await setupUserWithCompany(app);
    const { period } = await currentPeriod(ctx);
    const joinDate = new Date(period.startDate).toISOString().slice(0, 10);
    const nextDate = new Date(period.startDate);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const nextDateStr = nextDate.toISOString().slice(0, 10);
    const csv = [CSV_HEADER, `EMPW,Worked Me,,Helper,SA,true,,,,,,${joinDate},UNLIMITED,,,,21,5000,0,0,0,false`].join(
      "\n",
    );
    await request(app.getHttpServer()).post("/hr/employees/import").set(auth(ctx.accessToken)).send({ csv }).expect(201);
    const employee = (
      await request(app.getHttpServer()).get("/hr/employees").set(auth(ctx.accessToken)).expect(200)
    ).body[0];

    // WORKED with no explicit hours defaults to the standard 10-hour day
    await request(app.getHttpServer())
      .post("/hr/employee-timesheet/entry")
      .set(auth(ctx.accessToken))
      .send({ employeeId: employee.id, date: joinDate, dayType: "WORKED" })
      .expect(201);
    // REST with no explicit hours defaults to 0
    await request(app.getHttpServer())
      .post("/hr/employee-timesheet/entry")
      .set(auth(ctx.accessToken))
      .send({ employeeId: employee.id, date: nextDateStr, dayType: "REST" })
      .expect(201);

    const after = (
      await request(app.getHttpServer())
        .get(`/hr/employee-timesheet?fiscalPeriodId=${period.id}`)
        .set(auth(ctx.accessToken))
        .expect(200)
    ).body;
    const entries = after.employees.find((e: any) => e.employeeId === employee.id).entries;
    const workedEntry = entries.find((e: any) => e.date.slice(0, 10) === joinDate);
    const restEntry = entries.find((e: any) => e.date.slice(0, 10) === nextDateStr);
    expect(workedEntry.dayType).toBe("WORKED");
    expect(Number(workedEntry.hoursWorked)).toBe(10);
    expect(restEntry.dayType).toBe("REST");
    expect(Number(restEntry.hoursWorked)).toBe(0);

    // Switching that same WORKED day to ABSENT with no explicit hours zeroes it
    await request(app.getHttpServer())
      .post("/hr/employee-timesheet/entry")
      .set(auth(ctx.accessToken))
      .send({ employeeId: employee.id, date: joinDate, dayType: "ABSENT" })
      .expect(201);
    const afterAbsent = (
      await request(app.getHttpServer())
        .get(`/hr/employee-timesheet?fiscalPeriodId=${period.id}`)
        .set(auth(ctx.accessToken))
        .expect(200)
    ).body;
    const absentEntry = afterAbsent.employees
      .find((e: any) => e.employeeId === employee.id)
      .entries.find((e: any) => e.date.slice(0, 10) === joinDate);
    expect(absentEntry.dayType).toBe("ABSENT");
    expect(Number(absentEntry.hoursWorked)).toBe(0);
  });

  it("employees-dashboard computes hourlyRate × hoursWorked, groups by cost center, tracks pending advances/settlements, and lists released employees", async () => {
    const ctx = await setupUserWithCompany(app);
    const { period } = await currentPeriod(ctx);
    const joinDate = new Date(period.startDate).toISOString().slice(0, 10);

    await request(app.getHttpServer())
      .post("/cost-centers")
      .set(auth(ctx.accessToken))
      .send({ code: "SITE-1", name: "Site One" })
      .expect(201);

    const csv = [
      CSV_HEADER,
      // Basic 5,200 → hourlyRate 5200/260 = 20.00 exactly; assigned to SITE-1
      `EMPO1,On Site,,Mason,SA,true,,,,,,${joinDate},UNLIMITED,,,SITE-1,21,5200,0,0,0,false`,
      // No cost center → hourlyRate 2600/260 = 10.00; falls into "Unassigned"
      `EMPO2,No Site,,Helper,SA,true,,,,,,${joinDate},UNLIMITED,,,,21,2600,0,0,0,false`,
    ].join("\n");
    await request(app.getHttpServer()).post("/hr/employees/import").set(auth(ctx.accessToken)).send({ csv }).expect(201);
    const employees = (
      await request(app.getHttpServer()).get("/hr/employees").set(auth(ctx.accessToken)).expect(200)
    ).body;
    const empO1 = employees.find((e: any) => e.code === "EMPO1");
    const empO2 = employees.find((e: any) => e.code === "EMPO2");

    // EMPO1: 10 hours × 20.00 = 200.00; EMPO2: 10 hours × 10.00 = 100.00
    await request(app.getHttpServer())
      .post("/hr/employee-timesheet/entry")
      .set(auth(ctx.accessToken))
      .send({ employeeId: empO1.id, date: joinDate, dayType: "WORKED", hoursWorked: "10" })
      .expect(201);
    await request(app.getHttpServer())
      .post("/hr/employee-timesheet/entry")
      .set(auth(ctx.accessToken))
      .send({ employeeId: empO2.id, date: joinDate, dayType: "WORKED", hoursWorked: "10" })
      .expect(201);

    // An unsettled advance on EMPO1 (300 pending) and a fully-expensed allowance (excluded from pending)
    await request(app.getHttpServer())
      .post(`/hr/employees/${empO1.id}/payments`)
      .set(auth(ctx.accessToken))
      .send({ category: "ADVANCE", amount: "300", bankCashAccountId: ctx.cashAccount.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/hr/employees/${empO1.id}/payments`)
      .set(auth(ctx.accessToken))
      .send({ category: "ALLOWANCE", amount: "150", bankCashAccountId: ctx.cashAccount.id })
      .expect(201);

    const overview = (
      await request(app.getHttpServer())
        .get(`/hr/reports/employees-dashboard?fiscalPeriodId=${period.id}`)
        .set(auth(ctx.accessToken))
        .expect(200)
    ).body;

    const siteGroup = overview.groups.find((g: any) => g.label.includes("SITE-1"));
    expect(siteGroup).toBeDefined();
    const rowO1 = siteGroup.rows.find((r: any) => r.employeeId === empO1.id);
    expect(Number(rowO1.hourlyRate)).toBe(20);
    expect(Number(rowO1.cost)).toBe(200);
    expect(Number(siteGroup.subtotal)).toBe(200);

    // active-employees-detail must agree with the dashboard's cost for the same employee/period
    const detail = (
      await request(app.getHttpServer())
        .get(`/hr/reports/active-employees-detail?fiscalPeriodId=${period.id}`)
        .set(auth(ctx.accessToken))
        .expect(200)
    ).body;
    const detailO1 = detail.find((r: any) => r.employeeId === empO1.id);
    expect(Number(detailO1.cost)).toBe(Number(rowO1.cost));
    expect(Number(detailO1.allowancesPaid)).toBe(150);
    expect(Number(detailO1.pendingAdvances)).toBe(300);

    const unassignedGroup = overview.groups.find((g: any) => g.label === "Unassigned");
    expect(unassignedGroup).toBeDefined();
    const rowO2 = unassignedGroup.rows.find((r: any) => r.employeeId === empO2.id);
    expect(Number(rowO2.cost)).toBe(100);

    expect(Number(overview.grandTotal)).toBe(300);
    const dayEntry = overview.dailyLaborCost.find((d: any) => d.date === joinDate);
    expect(Number(dayEntry.cost)).toBe(300);

    // Total paid this period includes both payments (450); allowance excluded from pending
    expect(Number(overview.totalPaid)).toBe(450);
    expect(Number(overview.totalPendingAdvances)).toBe(300);
    // No payroll run posted, so the full accrued timesheet cost (300) is
    // still "owed" — pendingLaborAccrual = grandTotal(300) - payrollNetPay(0)
    expect(Number(overview.pendingLaborAccrual)).toBe(300);
    expect(Number(overview.totalPendingActive)).toBe(600);
    expect(Number(overview.totalPendingReleased)).toBe(0);
    expect(Number(overview.totalPending)).toBe(600);

    // Omitting fiscalPeriodId is "overall" mode — since every entry/payment above was
    // dated within this single period, the all-time figures must agree exactly.
    const overallOverview = (
      await request(app.getHttpServer())
        .get("/hr/reports/employees-dashboard")
        .set(auth(ctx.accessToken))
        .expect(200)
    ).body;
    expect(overallOverview.scope).toBe("overall");
    expect(Number(overallOverview.grandTotal)).toBe(300);
    expect(Number(overallOverview.totalPaid)).toBe(450);
    expect(Number(overallOverview.totalPending)).toBe(600);

    const overallDetail = (
      await request(app.getHttpServer())
        .get("/hr/reports/active-employees-detail")
        .set(auth(ctx.accessToken))
        .expect(200)
    ).body;
    const overallDetailO1 = overallDetail.find((r: any) => r.employeeId === empO1.id);
    expect(Number(overallDetailO1.cost)).toBe(Number(rowO1.cost));
    expect(Number(overallDetailO1.allowancesPaid)).toBe(150);

    // Release EMPO2 and confirm it appears in the released section with pending = net,
    // and that totalPendingSettlements now reflects it
    const lastWorkingDay = new Date(period.endDate).toISOString().slice(0, 10);
    const settlement = (
      await request(app.getHttpServer())
        .post(`/hr/employees/${empO2.id}/termination`)
        .set(auth(ctx.accessToken))
        .send({ reason: "TERMINATION_BY_EMPLOYER", lastWorkingDay })
        .expect(201)
    ).body;

    const overviewAfter = (
      await request(app.getHttpServer())
        .get(`/hr/reports/employees-dashboard?fiscalPeriodId=${period.id}`)
        .set(auth(ctx.accessToken))
        .expect(200)
    ).body;
    const releasedRow = overviewAfter.releasedEmployees.find((r: any) => r.employeeId === empO2.id);
    expect(releasedRow).toBeDefined();
    expect(Number(releasedRow.netAmount)).toBe(Number(settlement.netAmount));
    expect(Number(releasedRow.paidAmount)).toBe(0);
    expect(Number(releasedRow.pendingAmount)).toBe(Number(settlement.netAmount));
    expect(Number(overviewAfter.totalPendingSettlements)).toBe(Number(settlement.netAmount));
    expect(Number(overviewAfter.totalPendingReleased)).toBe(Number(settlement.netAmount));
    // EMPO2 dropped out of the active cost groups on release, so the
    // accrued-labor component of pending is now EMPO1 alone (200, not 300).
    expect(Number(overviewAfter.pendingLaborAccrual)).toBe(200);
    expect(Number(overviewAfter.totalPending)).toBe(500 + Number(settlement.netAmount));
    // No longer an active employee, so no longer in the cost groups
    expect(overviewAfter.groups.some((g: any) => g.rows.some((r: any) => r.employeeId === empO2.id))).toBe(false);
  });

  it("employee payments ledger: allowance posts a straight expense, advance stays pending, recovery clears it, over-recovery and allowance-recovery are rejected", async () => {
    const ctx = await setupUserWithCompany(app);
    const { period } = await currentPeriod(ctx);
    const joinDate = new Date(period.startDate).toISOString().slice(0, 10);
    const csv = [CSV_HEADER, `EMPP,Pay Me,,Helper,SA,true,,,,,,${joinDate},UNLIMITED,,,,21,4000,0,0,0,false`].join("\n");
    await request(app.getHttpServer()).post("/hr/employees/import").set(auth(ctx.accessToken)).send({ csv }).expect(201);
    const employee = (
      await request(app.getHttpServer()).get("/hr/employees").set(auth(ctx.accessToken)).expect(200)
    ).body[0];

    const allowance = (
      await request(app.getHttpServer())
        .post(`/hr/employees/${employee.id}/payments`)
        .set(auth(ctx.accessToken))
        .send({ category: "ALLOWANCE", amount: "500", bankCashAccountId: ctx.cashAccount.id, memo: "Eid allowance" })
        .expect(201)
    ).body;
    expect(allowance.paymentNumber).toMatch(/^EPY-/);

    const prisma = getPrisma(app);
    const allowanceJe = await prisma.employeePayment.findUniqueOrThrow({
      where: { id: allowance.id },
      include: { journalEntry: { include: { lines: { include: { account: true } } } } },
    });
    const allowanceLeg = (code: string) => allowanceJe.journalEntry.lines.find((l) => l.account.code === code)!;
    expect(Number(allowanceLeg("5215").debit)).toBeCloseTo(500, 2);
    expect(Number(allowanceLeg("1110").credit)).toBeCloseTo(500, 2);

    // Nothing to recover on an allowance
    await request(app.getHttpServer())
      .post(`/hr/employee-payments/${allowance.id}/recoveries`)
      .set(auth(ctx.accessToken))
      .send({ amount: "1", bankCashAccountId: ctx.cashAccount.id })
      .expect(409);

    const advance = (
      await request(app.getHttpServer())
        .post(`/hr/employees/${employee.id}/payments`)
        .set(auth(ctx.accessToken))
        .send({ category: "ADVANCE", amount: "1000", bankCashAccountId: ctx.cashAccount.id })
        .expect(201)
    ).body;
    const advanceJe = await prisma.employeePayment.findUniqueOrThrow({
      where: { id: advance.id },
      include: { journalEntry: { include: { lines: { include: { account: true } } } } },
    });
    const advanceLeg = (code: string) => advanceJe.journalEntry.lines.find((l) => l.account.code === code)!;
    expect(Number(advanceLeg("1160").debit)).toBeCloseTo(1000, 2);
    expect(Number(advanceLeg("1110").credit)).toBeCloseTo(1000, 2);

    // Over-recovery rejected
    await request(app.getHttpServer())
      .post(`/hr/employee-payments/${advance.id}/recoveries`)
      .set(auth(ctx.accessToken))
      .send({ amount: "1000.01", bankCashAccountId: ctx.cashAccount.id })
      .expect(400);

    // Partial recovery
    const afterPartial = (
      await request(app.getHttpServer())
        .post(`/hr/employee-payments/${advance.id}/recoveries`)
        .set(auth(ctx.accessToken))
        .send({ amount: "400", bankCashAccountId: ctx.cashAccount.id })
        .expect(201)
    ).body;
    expect(Number(afterPartial.recoveredAmount)).toBeCloseTo(400, 2);
    expect(afterPartial.recoveries).toHaveLength(1);
    const recoveryJe = await prisma.employeePaymentRecovery.findUniqueOrThrow({
      where: { id: afterPartial.recoveries[0].id },
      include: { journalEntry: { include: { lines: { include: { account: true } } } } },
    });
    const recoveryLeg = (code: string) => recoveryJe.journalEntry.lines.find((l) => l.account.code === code)!;
    expect(Number(recoveryLeg("1110").debit)).toBeCloseTo(400, 2);
    expect(Number(recoveryLeg("1160").credit)).toBeCloseTo(400, 2);

    // Final recovery brings pending to exactly zero
    const afterFinal = (
      await request(app.getHttpServer())
        .post(`/hr/employee-payments/${advance.id}/recoveries`)
        .set(auth(ctx.accessToken))
        .send({ amount: "600", bankCashAccountId: ctx.cashAccount.id })
        .expect(201)
    ).body;
    expect(Number(afterFinal.recoveredAmount)).toBeCloseTo(1000, 2);
    await request(app.getHttpServer())
      .post(`/hr/employee-payments/${advance.id}/recoveries`)
      .set(auth(ctx.accessToken))
      .send({ amount: "0.01", bankCashAccountId: ctx.cashAccount.id })
      .expect(400);
  });

  it("FOOD payments post to Allowance Expense like ALLOWANCE (tracked separately), and reversal excludes a payment from paid/pending", async () => {
    const ctx = await setupUserWithCompany(app);
    const { period } = await currentPeriod(ctx);
    const joinDate = new Date(period.startDate).toISOString().slice(0, 10);
    const csv = [CSV_HEADER, `EMPF,Food Test,,Helper,SA,true,,,,,,${joinDate},UNLIMITED,,,,21,4000,0,0,0,false`].join("\n");
    await request(app.getHttpServer()).post("/hr/employees/import").set(auth(ctx.accessToken)).send({ csv }).expect(201);
    const employee = (
      await request(app.getHttpServer()).get("/hr/employees").set(auth(ctx.accessToken)).expect(200)
    ).body[0];

    const food = (
      await request(app.getHttpServer())
        .post(`/hr/employees/${employee.id}/payments`)
        .set(auth(ctx.accessToken))
        .send({ category: "FOOD", amount: "200", bankCashAccountId: ctx.cashAccount.id, memo: "Monthly food" })
        .expect(201)
    ).body;
    expect(food.category).toBe("FOOD");
    expect(Number(food.recoveredAmount)).toBe(0);

    const prisma = getPrisma(app);
    const foodJe = await prisma.employeePayment.findUniqueOrThrow({
      where: { id: food.id },
      include: { journalEntry: { include: { lines: { include: { account: true } } } } },
    });
    // Same control account as ALLOWANCE (5215), tracked separately only in the app layer
    expect(foodJe.journalEntry.lines.find((l) => l.account.code === "5215")!.debit.toString()).toBe("200");

    // Straight expense — nothing to recover
    await request(app.getHttpServer())
      .post(`/hr/employee-payments/${food.id}/recoveries`)
      .set(auth(ctx.accessToken))
      .send({ amount: "1", bankCashAccountId: ctx.cashAccount.id })
      .expect(409);

    const summaryBefore = (
      await request(app.getHttpServer())
        .get(`/hr/employees/${employee.id}/summary`)
        .set(auth(ctx.accessToken))
        .expect(200)
    ).body;
    expect(Number(summaryBefore.paidFood)).toBe(200);
    expect(Number(summaryBefore.pendingFood)).toBe(0);
    // Food never counts as pending advance/other
    expect(Number(summaryBefore.pendingAllowance)).toBe(0);

    // Now correct a wrongly-recorded ALLOWANCE payment via reversal
    const wrongAllowance = (
      await request(app.getHttpServer())
        .post(`/hr/employees/${employee.id}/payments`)
        .set(auth(ctx.accessToken))
        .send({ category: "ALLOWANCE", amount: "100", bankCashAccountId: ctx.cashAccount.id, memo: "wrong entry" })
        .expect(201)
    ).body;

    const reversed = (
      await request(app.getHttpServer())
        .post(`/hr/employee-payments/${wrongAllowance.id}/reverse`)
        .set(auth(ctx.accessToken))
        .expect(201)
    ).body;
    expect(reversed.reversedAt).not.toBeNull();

    // The original JE is now REVERSED and a balancing reversing JE exists
    const originalJe = await prisma.journalEntry.findUniqueOrThrow({ where: { id: wrongAllowance.journalEntryId } });
    expect(originalJe.status).toBe("REVERSED");

    // Reversed payment is excluded from paidAllowance
    const summaryAfter = (
      await request(app.getHttpServer())
        .get(`/hr/employees/${employee.id}/summary`)
        .set(auth(ctx.accessToken))
        .expect(200)
    ).body;
    expect(Number(summaryAfter.paidAllowance)).toBe(0);
    expect(Number(summaryAfter.paidFood)).toBe(200);

    // Double-reversal rejected
    await request(app.getHttpServer())
      .post(`/hr/employee-payments/${wrongAllowance.id}/reverse`)
      .set(auth(ctx.accessToken))
      .expect(409);
  });

  it("food entitlement accrues monthly from the salary structure's Other field, and a FOOD payment pays it down", async () => {
    const ctx = await setupUserWithCompany(app);
    // Same day-of-month, exactly 2 calendar months back, so serviceYears'
    // day-fraction component is exactly 0 and months land on a clean 2.00.
    const now = new Date();
    const joinDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, now.getUTCDate()))
      .toISOString()
      .slice(0, 10);
    // otherAllowance = 100 → 2 months of service → 200 entitled to date
    const csv = [CSV_HEADER, `EMPFA,Food Accrual,,Helper,SA,true,,,,,,${joinDate},UNLIMITED,,,,21,3000,0,0,100,false`].join(
      "\n",
    );
    await request(app.getHttpServer()).post("/hr/employees/import").set(auth(ctx.accessToken)).send({ csv }).expect(201);
    const employee = (
      await request(app.getHttpServer()).get("/hr/employees").set(auth(ctx.accessToken)).expect(200)
    ).body[0];

    const before = (
      await request(app.getHttpServer())
        .get(`/hr/employees/${employee.id}/summary`)
        .set(auth(ctx.accessToken))
        .expect(200)
    ).body;
    expect(Number(before.foodEntitledToDate)).toBeCloseTo(200, 2);
    expect(Number(before.pendingFood)).toBeCloseTo(200, 2);
    expect(Number(before.paidFood)).toBe(0);

    // Pay 150 of the 200 entitled
    await request(app.getHttpServer())
      .post(`/hr/employees/${employee.id}/payments`)
      .set(auth(ctx.accessToken))
      .send({ category: "FOOD", amount: "150", bankCashAccountId: ctx.cashAccount.id })
      .expect(201);

    const after = (
      await request(app.getHttpServer())
        .get(`/hr/employees/${employee.id}/summary`)
        .set(auth(ctx.accessToken))
        .expect(200)
    ).body;
    expect(Number(after.paidFood)).toBe(150);
    expect(Number(after.pendingFood)).toBeCloseTo(50, 2);

    // Overpaying beyond the entitlement is allowed (advance food payment) but floors pending at 0
    await request(app.getHttpServer())
      .post(`/hr/employees/${employee.id}/payments`)
      .set(auth(ctx.accessToken))
      .send({ category: "FOOD", amount: "100", bankCashAccountId: ctx.cashAccount.id })
      .expect(201);
    const afterOverpay = (
      await request(app.getHttpServer())
        .get(`/hr/employees/${employee.id}/summary`)
        .set(auth(ctx.accessToken))
        .expect(200)
    ).body;
    expect(Number(afterOverpay.paidFood)).toBe(250);
    expect(Number(afterOverpay.pendingFood)).toBe(0);

    // Also reflected in the main employees list — never miscounted as an
    // unrecovered advance (only ADVANCE/OTHER contribute to pendingAmount there)
    const list = (
      await request(app.getHttpServer()).get("/hr/employees").set(auth(ctx.accessToken)).expect(200)
    ).body;
    const listRow = list.find((e: any) => e.id === employee.id);
    expect(Number(listRow.pendingAmount)).toBe(0);
  });

  it("blocks employee deletion once an employee payment exists", async () => {
    const ctx = await setupUserWithCompany(app);
    const { period } = await currentPeriod(ctx);
    const joinDate = new Date(period.startDate).toISOString().slice(0, 10);
    const csv = [CSV_HEADER, `EMPD,Delete Me,,Helper,SA,true,,,,,,${joinDate},UNLIMITED,,,,21,3000,0,0,0,false`].join("\n");
    await request(app.getHttpServer()).post("/hr/employees/import").set(auth(ctx.accessToken)).send({ csv }).expect(201);
    const employee = (
      await request(app.getHttpServer()).get("/hr/employees").set(auth(ctx.accessToken)).expect(200)
    ).body[0];

    await request(app.getHttpServer())
      .post(`/hr/employees/${employee.id}/payments`)
      .set(auth(ctx.accessToken))
      .send({ category: "ALLOWANCE", amount: "100", bankCashAccountId: ctx.cashAccount.id })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/hr/employees/${employee.id}`)
      .set(auth(ctx.accessToken))
      .expect(409);
  });

  it("employee summary aggregates paid/pending amounts and timesheet attendance counts", async () => {
    const ctx = await setupUserWithCompany(app);
    const { period } = await currentPeriod(ctx);
    const joinDate = new Date(period.startDate).toISOString().slice(0, 10);
    const csv = [CSV_HEADER, `EMPS,Summary Me,,Helper,SA,true,,,,,,${joinDate},UNLIMITED,,,,21,4000,0,0,0,false`].join("\n");
    await request(app.getHttpServer()).post("/hr/employees/import").set(auth(ctx.accessToken)).send({ csv }).expect(201);
    const employee = (
      await request(app.getHttpServer()).get("/hr/employees").set(auth(ctx.accessToken)).expect(200)
    ).body[0];

    const advance = (
      await request(app.getHttpServer())
        .post(`/hr/employees/${employee.id}/payments`)
        .set(auth(ctx.accessToken))
        .send({ category: "ADVANCE", amount: "500", bankCashAccountId: ctx.cashAccount.id })
        .expect(201)
    ).body;
    await request(app.getHttpServer())
      .post(`/hr/employees/${employee.id}/payments`)
      .set(auth(ctx.accessToken))
      .send({ category: "ALLOWANCE", amount: "200", bankCashAccountId: ctx.cashAccount.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/hr/employee-payments/${advance.id}/recoveries`)
      .set(auth(ctx.accessToken))
      .send({ amount: "200", bankCashAccountId: ctx.cashAccount.id })
      .expect(201);

    const day1 = joinDate;
    const day2 = new Date(new Date(joinDate).getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    const day3 = new Date(new Date(joinDate).getTime() + 2 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    await request(app.getHttpServer())
      .post("/hr/employee-timesheet/entry")
      .set(auth(ctx.accessToken))
      .send({ employeeId: employee.id, date: day1, dayType: "WORKED", hoursWorked: "8" })
      .expect(201);
    await request(app.getHttpServer())
      .post("/hr/employee-timesheet/entry")
      .set(auth(ctx.accessToken))
      .send({ employeeId: employee.id, date: day2, dayType: "ABSENT" })
      .expect(201);
    await request(app.getHttpServer())
      .post("/hr/employee-timesheet/entry")
      .set(auth(ctx.accessToken))
      .send({ employeeId: employee.id, date: day3, dayType: "UNPAID_LEAVE" })
      .expect(201);

    // Bulk prefill creates WORKED/0h placeholders for every untouched day —
    // those must NOT count toward workedDays, only real (>0h) worked days do
    await request(app.getHttpServer())
      .post("/hr/employee-timesheet/prefill")
      .set(auth(ctx.accessToken))
      .send({ fiscalPeriodId: period.id })
      .expect(201);

    const beforePayroll = (
      await request(app.getHttpServer())
        .get(`/hr/employees/${employee.id}/summary`)
        .set(auth(ctx.accessToken))
        .expect(200)
    ).body;

    // Salary side: with no payroll posted yet, the whole timesheet-accrued
    // labor cost is genuinely pending, and nothing is paid as salary.
    expect(Number(beforePayroll.paidSalary)).toBe(0);
    expect(Number(beforePayroll.paidAdvance)).toBe(500);
    expect(Number(beforePayroll.paidAllowance)).toBe(200);
    expect(Number(beforePayroll.totalPaid)).toBe(700);
    expect(Number(beforePayroll.pendingLaborAccrual)).toBeGreaterThan(0);
    expect(Number(beforePayroll.pendingSalary)).toBe(Number(beforePayroll.pendingLaborAccrual));
    expect(Number(beforePayroll.pendingAllowance)).toBe(300);
    expect(Number(beforePayroll.loanBalance)).toBe(0);
    expect(Number(beforePayroll.settlementPending)).toBe(0);
    expect(Number(beforePayroll.totalPending)).toBe(
      Number(beforePayroll.pendingSalary) + Number(beforePayroll.pendingAllowance) + Number(beforePayroll.loanBalance),
    );
    expect(beforePayroll.workedDays).toBe(1);
    expect(Number(beforePayroll.workedHours)).toBe(8);
    expect(beforePayroll.absentDays).toBe(1);
    expect(beforePayroll.unpaidLeaveDays).toBe(1);

    // Post payroll for the period — this employee's basic salary (4000) far
    // exceeds their ~123 accrued timesheet cost, so pendingSalary should
    // floor at zero (settlementPending stays 0, not released) and paidSalary
    // should reflect the actual posted net pay exactly.
    const run = (
      await request(app.getHttpServer())
        .post("/hr/payroll-runs")
        .set(auth(ctx.accessToken))
        .send({ fiscalPeriodId: period.id })
        .expect(201)
    ).body;
    await request(app.getHttpServer()).post(`/hr/payroll-runs/${run.id}/post`).set(auth(ctx.accessToken)).expect(201);
    const prisma = getPrisma(app);
    const postedLine = await prisma.payrollRunLine.findFirstOrThrow({ where: { runId: run.id, employeeId: employee.id } });

    const summary = (
      await request(app.getHttpServer())
        .get(`/hr/employees/${employee.id}/summary`)
        .set(auth(ctx.accessToken))
        .expect(200)
    ).body;

    expect(Number(summary.paidSalary)).toBeCloseTo(Number(postedLine.netPay), 2);
    expect(Number(summary.paidAdvance)).toBe(500);
    expect(Number(summary.paidAllowance)).toBe(200);
    expect(Number(summary.totalPaid)).toBeCloseTo(Number(postedLine.netPay) + 700, 2);
    expect(Number(summary.pendingLaborAccrual)).toBe(0);
    expect(Number(summary.pendingSalary)).toBe(0);
    expect(Number(summary.pendingAllowance)).toBe(300);
    expect(Number(summary.loanBalance)).toBe(0);
    expect(Number(summary.settlementPending)).toBe(0);
    expect(Number(summary.totalPending)).toBe(300);
    expect(summary.workedDays).toBe(1);
    expect(Number(summary.workedHours)).toBe(8);
    expect(summary.absentDays).toBe(1);
    expect(summary.unpaidLeaveDays).toBe(1);
  });

  it("SALARY-category payment pays down pending timesheet-accrued salary directly, without formal payroll", async () => {
    const ctx = await setupUserWithCompany(app);
    const { period } = await currentPeriod(ctx);
    const joinDate = new Date(period.startDate).toISOString().slice(0, 10);
    // Basic 2600 → hourlyRate 2600/260 = 10.00 exactly
    const csv = [CSV_HEADER, `EMPSAL,Salary Pay,,Helper,SA,true,,,,,,${joinDate},UNLIMITED,,,,21,2600,0,0,0,false`].join("\n");
    await request(app.getHttpServer()).post("/hr/employees/import").set(auth(ctx.accessToken)).send({ csv }).expect(201);
    const employee = (
      await request(app.getHttpServer()).get("/hr/employees").set(auth(ctx.accessToken)).expect(200)
    ).body[0];

    // 10 hours × 10.00 = 100.00 accrued, nothing paid via payroll yet
    await request(app.getHttpServer())
      .post("/hr/employee-timesheet/entry")
      .set(auth(ctx.accessToken))
      .send({ employeeId: employee.id, date: joinDate, dayType: "WORKED", hoursWorked: "10" })
      .expect(201);

    const before = (
      await request(app.getHttpServer())
        .get(`/hr/employees/${employee.id}/summary`)
        .set(auth(ctx.accessToken))
        .expect(200)
    ).body;
    expect(Number(before.pendingSalary)).toBe(100);
    expect(Number(before.paidSalary)).toBe(0);

    // Pay 60 directly against the pending salary — no formal payroll run
    const payment = (
      await request(app.getHttpServer())
        .post(`/hr/employees/${employee.id}/payments`)
        .set(auth(ctx.accessToken))
        .send({ category: "SALARY", amount: "60", bankCashAccountId: ctx.cashAccount.id })
        .expect(201)
    ).body;
    expect(payment.category).toBe("SALARY");
    expect(Number(payment.recoveredAmount)).toBe(0);

    const after = (
      await request(app.getHttpServer())
        .get(`/hr/employees/${employee.id}/summary`)
        .set(auth(ctx.accessToken))
        .expect(200)
    ).body;
    expect(Number(after.paidSalary)).toBe(60);
    expect(Number(after.pendingSalary)).toBe(40);
    // SALARY is a straight expense like ALLOWANCE — must never land in the
    // advance/other "pendingAllowance" bucket.
    expect(Number(after.pendingAllowance)).toBe(0);

    // GL: posted to SALARY_EXPENSE (5200), no cost center (employee has none) — not EMPLOYEE_LOANS
    const prisma = getPrisma(app);
    const je = await prisma.journalEntry.findFirst({
      where: { companyId: ctx.companyId, sourceDocumentId: payment.id },
      include: { lines: { include: { account: true } } },
    });
    expect(je).not.toBeNull();
    const debitLeg = je!.lines.find((l) => l.debit.gt(0))!;
    expect(debitLeg.account.code).toBe("5200");

    // A recovery attempt against a SALARY payment must be rejected
    await request(app.getHttpServer())
      .post(`/hr/employee-payments/${payment.id}/recoveries`)
      .set(auth(ctx.accessToken))
      .send({ amount: "10", bankCashAccountId: ctx.cashAccount.id })
      .expect(409);
  });

  it("employee timesheet-detail returns overall vs period-scoped day records with per-day cost", async () => {
    const ctx = await setupUserWithCompany(app);
    const { period, periods } = await currentPeriod(ctx);
    const joinDate = new Date(period.startDate).toISOString().slice(0, 10);
    const csv = [CSV_HEADER, `EMPTD,Timesheet Detail,,Helper,SA,true,,,,,,${joinDate},UNLIMITED,,,,21,2600,0,0,0,false`].join(
      "\n",
    );
    await request(app.getHttpServer()).post("/hr/employees/import").set(auth(ctx.accessToken)).send({ csv }).expect(201);
    const employee = (
      await request(app.getHttpServer()).get("/hr/employees").set(auth(ctx.accessToken)).expect(200)
    ).body[0];

    // hourlyRate = 2600 / 260 = 10 exactly, for a clean expected cost
    await request(app.getHttpServer())
      .post("/hr/employee-timesheet/entry")
      .set(auth(ctx.accessToken))
      .send({ employeeId: employee.id, date: joinDate, dayType: "WORKED", hoursWorked: "8" })
      .expect(201);

    const otherPeriod = periods.find((p: any) => p.id !== period.id);
    const otherDate = new Date(otherPeriod.startDate).toISOString().slice(0, 10);
    await request(app.getHttpServer())
      .post("/hr/employee-timesheet/entry")
      .set(auth(ctx.accessToken))
      .send({ employeeId: employee.id, date: otherDate, dayType: "WORKED", hoursWorked: "5" })
      .expect(201);

    const overall = (
      await request(app.getHttpServer())
        .get(`/hr/employees/${employee.id}/timesheet-detail`)
        .set(auth(ctx.accessToken))
        .expect(200)
    ).body;
    expect(overall.scope).toBe("overall");
    expect(overall.entries).toHaveLength(2);
    expect(Number(overall.hourlyRate)).toBe(10);
    expect(Number(overall.totalHours)).toBe(13);
    expect(Number(overall.totalCost)).toBe(130);

    const scoped = (
      await request(app.getHttpServer())
        .get(`/hr/employees/${employee.id}/timesheet-detail?fiscalPeriodId=${period.id}`)
        .set(auth(ctx.accessToken))
        .expect(200)
    ).body;
    expect(scoped.scope).toBe("period");
    expect(scoped.fiscalPeriodId).toBe(period.id);
    expect(scoped.entries).toHaveLength(1);
    expect(Number(scoped.totalHours)).toBe(8);
    expect(Number(scoped.totalCost)).toBe(80);

    // Unknown employee / period still 404, matching the rest of this module
    await request(app.getHttpServer())
      .get(`/hr/employees/${employee.id}/timesheet-detail?fiscalPeriodId=00000000-0000-0000-0000-000000000000`)
      .set(auth(ctx.accessToken))
      .expect(404);
  });
});
