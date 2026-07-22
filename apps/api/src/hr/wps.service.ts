import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PayrollRunStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { HrSettingsService } from "./hr-settings.service";

/**
 * Mudad-compatible WPS SIF (Salary Information File) generator.
 *
 * Layout (CSV):
 *   EMPLOYER,<MOL establishment ID>,<employer bank code>,<employer IBAN>,
 *            <file date YYYY-MM-DD>,<salary month YYYY-MM>,<employee count>,<total net>
 *   EMPLOYEE,<employee code>,<iqama/national ID>,<name>,<bank code>,<IBAN>,
 *            <basic>,<housing>,<other earnings>,<deductions>,<net>
 *
 * "Other earnings" = transport + other allowances + overtime; "deductions" =
 * GOSI employee share + loans + absence + other, so basic + housing + other −
 * deductions always reconciles to net.
 */
@Injectable()
export class WpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hrSettingsService: HrSettingsService,
  ) {}

  async generateSif(companyId: string, runId: string): Promise<{ filename: string; content: string }> {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id: runId, companyId },
      include: {
        fiscalPeriod: true,
        lines: {
          orderBy: { employee: { code: "asc" } },
          include: { employee: true },
        },
      },
    });
    if (!run) {
      throw new NotFoundException("Payroll run not found");
    }
    if (run.status !== PayrollRunStatus.POSTED) {
      throw new BadRequestException("WPS files are generated from posted runs only");
    }

    const settings = await this.hrSettingsService.get(companyId);
    if (!settings.molEstablishmentId || !settings.employerBankCode || !settings.employerIban) {
      throw new BadRequestException(
        "WPS employer identifiers are missing — set MOL establishment ID, bank code and IBAN in HR settings",
      );
    }

    const missingBank = run.lines.filter((l) => !l.employee.iban || !l.employee.bankCode);
    if (missingBank.length > 0) {
      throw new BadRequestException(
        `Employees missing bank code/IBAN: ${missingBank.map((l) => l.employee.code).join(", ")}`,
      );
    }

    const periodStart = run.fiscalPeriod.startDate;
    const salaryMonth = `${periodStart.getUTCFullYear()}-${String(periodStart.getUTCMonth() + 1).padStart(2, "0")}`;
    const fileDate = new Date().toISOString().slice(0, 10);

    const rows: string[] = [];
    rows.push(
      [
        "EMPLOYER",
        settings.molEstablishmentId,
        settings.employerBankCode,
        settings.employerIban,
        fileDate,
        salaryMonth,
        String(run.lines.length),
        run.totalNetPay.toFixed(2),
      ].join(","),
    );

    for (const line of run.lines) {
      const otherEarnings = line.transportAllowance.add(line.otherAllowance).add(line.overtimePay);
      const deductions = line.gosiEmployee
        .add(line.loanDeduction)
        .add(line.absenceDeduction)
        .add(line.otherDeduction);
      rows.push(
        [
          "EMPLOYEE",
          line.employee.code,
          line.employee.iqamaOrNationalId ?? "",
          // SIF is comma-delimited — strip commas from free-text names
          line.employee.nameEn.replace(/,/g, " "),
          line.employee.bankCode!,
          line.employee.iban!,
          line.basicSalary.toFixed(2),
          line.housingAllowance.toFixed(2),
          otherEarnings.toFixed(2),
          deductions.toFixed(2),
          line.netPay.toFixed(2),
        ].join(","),
      );
    }

    // Reconciliation guard: header total must equal the sum of detail nets
    const detailTotal = run.lines.reduce((acc, l) => acc.add(l.netPay), new Prisma.Decimal(0));
    if (!detailTotal.eq(run.totalNetPay)) {
      throw new BadRequestException("SIF total does not reconcile with run net pay — recompute the run");
    }

    return {
      filename: `WPS_${settings.molEstablishmentId}_${salaryMonth}_${run.runNumber}.csv`,
      content: rows.join("\r\n") + "\r\n",
    };
  }
}
