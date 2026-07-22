import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  ControlAccountType,
  DocumentType,
  EmployeeStatus,
  JournalSourceModule,
  LoanStatus,
  Prisma,
} from "@prisma/client";
import { randomUUID } from "crypto";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { GlPostingService } from "../gl/gl-posting.service";
import { NumberingService } from "../numbering/numbering.service";
import { AccountResolutionService } from "../finance/account-resolution.service";
import { CreateLoanDto } from "./dto/hr.dtos";

@Injectable()
export class LoansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly glPostingService: GlPostingService,
    private readonly numberingService: NumberingService,
    private readonly accountResolution: AccountResolutionService,
  ) {}

  async list(companyId: string, employeeId?: string) {
    return this.prisma.employeeLoan.findMany({
      where: { companyId, ...(employeeId ? { employeeId } : {}) },
      orderBy: { createdAt: "desc" },
      include: { employee: { select: { code: true, nameEn: true } } },
    });
  }

  /** Creates and disburses in one transaction: Dr 1160 / Cr bank-or-cash. */
  async createAndDisburse(companyId: string, employeeId: string, userId: string, dto: CreateLoanDto) {
    const loan = await this.prisma.$transaction(
      async (tx) => {
        const employee = await tx.employee.findFirst({ where: { id: employeeId, companyId } });
        if (!employee) {
          throw new NotFoundException("Employee not found");
        }
        if (employee.status !== EmployeeStatus.ACTIVE) {
          throw new ConflictException("Loans can only be issued to active employees");
        }

        const principal = new Prisma.Decimal(dto.principal);
        const loansControl = await this.accountResolution.getControlAccount(
          tx,
          companyId,
          ControlAccountType.EMPLOYEE_LOANS,
        );
        const payingAccount = await this.accountResolution.getBankOrCashAccount(
          tx,
          companyId,
          dto.disbursementAccountId,
        );

        const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
        const disbursementDate = dto.disbursementDate ? new Date(dto.disbursementDate) : new Date();
        const loanId = randomUUID();
        const loanNumber = await this.numberingService.allocate(tx, {
          companyId,
          documentType: DocumentType.EMPLOYEE_LOAN,
          fiscalYearId: null,
        });

        const entry = await this.glPostingService.createPostedEntry(tx, {
          companyId,
          userId,
          postingDate: disbursementDate,
          documentDate: disbursementDate,
          currencyCode: company.baseCurrencyCode,
          exchangeRateToFunctional: new Prisma.Decimal(1),
          sourceModule: JournalSourceModule.PAYROLL,
          sourceDocumentId: loanId,
          memo: `Employee loan ${loanNumber} — ${employee.code} ${employee.nameEn}`,
          lines: [
            {
              accountId: loansControl.id,
              debit: principal,
              credit: new Prisma.Decimal(0),
              amountInTransactionCurrency: principal,
              description: `Loan ${loanNumber} to ${employee.code}`,
            },
            {
              accountId: payingAccount.id,
              debit: new Prisma.Decimal(0),
              credit: principal,
              amountInTransactionCurrency: principal,
              description: `Loan ${loanNumber} disbursement`,
            },
          ],
        });

        return tx.employeeLoan.create({
          data: {
            id: loanId,
            companyId,
            employeeId,
            loanNumber,
            principal,
            monthlyInstallment: new Prisma.Decimal(dto.monthlyInstallment),
            balance: principal,
            disbursementJournalEntryId: entry.id,
            disbursementAccountId: payingAccount.id,
            memo: dto.memo,
            createdByUserId: userId,
          },
          include: { employee: { select: { code: true, nameEn: true } } },
        });
      },
      { timeout: 30_000 },
    );

    await this.auditService.log({
      companyId,
      entityName: "EmployeeLoan",
      entityId: loan.id,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: loan,
    });

    return loan;
  }

  /** Cancel = reverse the disbursement; only before any payroll deduction. */
  async cancel(companyId: string, loanId: string, userId: string) {
    const cancelled = await this.prisma.$transaction(
      async (tx) => {
        const loan = await tx.employeeLoan.findFirst({ where: { id: loanId, companyId } });
        if (!loan) {
          throw new NotFoundException("Loan not found");
        }
        if (loan.status !== LoanStatus.ACTIVE) {
          throw new ConflictException(`Loan is ${loan.status}`);
        }
        if (!loan.balance.eq(loan.principal)) {
          throw new ConflictException("Loan already has payroll deductions — it can no longer be cancelled");
        }

        await this.glPostingService.reverseEntryInTx(tx, companyId, loan.disbursementJournalEntryId, userId);

        return tx.employeeLoan.update({
          where: { id: loanId },
          data: { status: LoanStatus.CANCELLED, balance: new Prisma.Decimal(0) },
        });
      },
      { timeout: 30_000 },
    );

    await this.auditService.log({
      companyId,
      entityName: "EmployeeLoan",
      entityId: loanId,
      action: "REVERSE",
      changedByUserId: userId,
      afterSnapshot: cancelled,
    });

    return cancelled;
  }
}
