import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  ControlAccountType,
  DocumentType,
  InvoiceStatus,
  JournalSourceModule,
  PartnerType,
  PaymentDirection,
  PaymentStatus,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { NumberingService } from "../numbering/numbering.service";
import { GlPostingService, PostedEntryLineInput } from "../gl/gl-posting.service";
import { AuditService } from "../audit/audit.service";
import { AccountResolutionService } from "./account-resolution.service";
import { CreatePaymentDto } from "./dto/create-payment.dto";

const OPEN_STATUSES: InvoiceStatus[] = [InvoiceStatus.POSTED, InvoiceStatus.PARTIALLY_PAID];

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingService: NumberingService,
    private readonly glPostingService: GlPostingService,
    private readonly auditService: AuditService,
    private readonly accountResolution: AccountResolutionService,
  ) {}

  /**
   * Creates and posts a payment atomically (payments have no draft state):
   * validates partner/account/allocations, allocates the payment number,
   * posts the JE, writes the payment + allocation rows, and updates each
   * allocated invoice's paid/open amounts and status — all in one
   * transaction.
   */
  async createPayment(companyId: string, userId: string, direction: PaymentDirection, dto: CreatePaymentDto) {
    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lte(0)) {
      throw new BadRequestException("Payment amount must be positive");
    }

    const payment = await this.prisma.$transaction(async (tx) => {
      const partner = await tx.businessPartner.findFirst({
        where: { id: dto.businessPartnerId, companyId, isActive: true },
      });
      if (!partner) {
        throw new NotFoundException("Business partner not found");
      }
      if (direction === PaymentDirection.INCOMING && partner.partnerType === PartnerType.VENDOR) {
        throw new BadRequestException("Incoming payments require a customer");
      }
      if (direction === PaymentDirection.OUTGOING && partner.partnerType === PartnerType.CUSTOMER) {
        throw new BadRequestException("Outgoing payments require a vendor");
      }

      const bankCashAccount = await this.accountResolution.getBankOrCashAccount(tx, companyId, dto.bankCashAccountId);
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
      const paymentDate = new Date(dto.paymentDate);
      const paymentRate = await this.resolveExchangeRate(tx, companyId, company.baseCurrencyCode, company.baseCurrencyCode, paymentDate);

      // Load and validate allocated invoices (locking reads happen naturally
      // via the row updates below inside this same transaction).
      const allocationInputs = dto.allocations ?? [];
      const totalAllocated = allocationInputs.reduce((sum, a) => sum.add(new Prisma.Decimal(a.amount)), new Prisma.Decimal(0));
      if (totalAllocated.gt(amount)) {
        throw new BadRequestException(
          `Allocations (${totalAllocated}) exceed the payment amount (${amount})`,
        );
      }

      interface LoadedAllocation {
        invoiceId: string;
        amount: Prisma.Decimal;
        invoiceRate: Prisma.Decimal;
        currencyCode: string;
      }
      const loaded: LoadedAllocation[] = [];

      for (const alloc of allocationInputs) {
        const allocAmount = new Prisma.Decimal(alloc.amount);
        if (allocAmount.lte(0)) {
          throw new BadRequestException("Allocation amounts must be positive");
        }

        if (direction === PaymentDirection.INCOMING) {
          const invoice = await tx.salesInvoice.findFirst({
            where: { id: alloc.invoiceId, companyId, businessPartnerId: partner.id },
          });
          if (!invoice || !OPEN_STATUSES.includes(invoice.status)) {
            throw new BadRequestException(`Invoice ${alloc.invoiceId} is not an open invoice of this customer`);
          }
          if (allocAmount.gt(invoice.openAmount)) {
            throw new BadRequestException(
              `Allocation (${allocAmount}) exceeds invoice ${invoice.invoiceNumber}'s open amount (${invoice.openAmount})`,
            );
          }
          loaded.push({
            invoiceId: invoice.id,
            amount: allocAmount,
            invoiceRate: invoice.exchangeRateToFunctional,
            currencyCode: invoice.currencyCode,
          });
        } else {
          const invoice = await tx.purchaseInvoice.findFirst({
            where: { id: alloc.invoiceId, companyId, businessPartnerId: partner.id },
          });
          if (!invoice || !OPEN_STATUSES.includes(invoice.status)) {
            throw new BadRequestException(`Invoice ${alloc.invoiceId} is not an open invoice of this vendor`);
          }
          if (allocAmount.gt(invoice.openAmount)) {
            throw new BadRequestException(
              `Allocation (${allocAmount}) exceeds invoice ${invoice.invoiceNumber}'s open amount (${invoice.openAmount})`,
            );
          }
          loaded.push({
            invoiceId: invoice.id,
            amount: allocAmount,
            invoiceRate: invoice.exchangeRateToFunctional,
            currencyCode: invoice.currencyCode,
          });
        }
      }

      // Phase 2 constraint: payment currency = company base currency = every
      // allocated invoice's currency. Multi-currency settlement (invoice-rate
      // AR/AP relief + FX difference to 5850) activates when invoices in a
      // non-base currency exist; for now enforce homogeneity for correctness.
      for (const l of loaded) {
        if (l.currencyCode !== company.baseCurrencyCode) {
          throw new BadRequestException(
            "Settling foreign-currency invoices is not supported yet — invoice and payment must be in the company base currency",
          );
        }
      }

      const unallocated = amount.sub(totalAllocated);

      // GL composition. Functional amounts: AR/AP relief at each invoice's
      // original rate; cash at the payment-date rate; any difference to the
      // FX gain/loss account (zero for same-currency, which is all Phase 2
      // allows — the structure is here for when FX activates).
      const controlAccount = await this.accountResolution.getControlAccount(
        tx, companyId, direction === PaymentDirection.INCOMING ? ControlAccountType.AR : ControlAccountType.AP,
      );

      const zero = new Prisma.Decimal(0);
      const cashFunctional = amount.mul(paymentRate).toDecimalPlaces(4);
      const reliefFunctional = loaded
        .reduce((sum, l) => sum.add(l.amount.mul(l.invoiceRate)), zero)
        .add(unallocated.mul(paymentRate))
        .toDecimalPlaces(4);

      const glLines: PostedEntryLineInput[] = [];
      if (direction === PaymentDirection.INCOMING) {
        glLines.push({
          accountId: bankCashAccount.id,
          debit: cashFunctional,
          credit: zero,
          amountInTransactionCurrency: amount,
          description: "Incoming payment",
        });
        glLines.push({
          accountId: controlAccount.id,
          debit: zero,
          credit: reliefFunctional,
          amountInTransactionCurrency: amount,
          businessPartnerId: partner.id,
          description: "AR settlement",
        });
      } else {
        glLines.push({
          accountId: controlAccount.id,
          debit: reliefFunctional,
          credit: zero,
          amountInTransactionCurrency: amount,
          businessPartnerId: partner.id,
          description: "AP settlement",
        });
        glLines.push({
          accountId: bankCashAccount.id,
          debit: zero,
          credit: cashFunctional,
          amountInTransactionCurrency: amount,
          description: "Outgoing payment",
        });
      }

      const fxDifference = cashFunctional.sub(reliefFunctional);
      if (!fxDifference.eq(0)) {
        const fxAccount = await tx.account.findFirst({
          where: { companyId, code: "5850", isActive: true, isPostable: true },
        });
        if (!fxAccount) {
          throw new BadRequestException("FX difference arose but no 5850 Foreign Exchange Gain/Loss account exists");
        }
        glLines.push({
          accountId: fxAccount.id,
          debit: fxDifference.lt(0) ? fxDifference.abs() : zero,
          credit: fxDifference.gt(0) ? fxDifference : zero,
          amountInTransactionCurrency: fxDifference.abs(),
          description: "FX difference on settlement",
        });
      }

      // Payment row is created FIRST (without its JE link), so the posted JE
      // can carry the real sourceDocumentId from birth — posted JEs are
      // immutable at the DB level, so patching sourceDocumentId afterwards
      // is (correctly) impossible.
      const paymentNumber = await this.numberingService.allocate(tx, {
        companyId,
        documentType: direction === PaymentDirection.INCOMING ? DocumentType.INCOMING_PAYMENT : DocumentType.OUTGOING_PAYMENT,
        fiscalYearId: null,
      });

      const created = await tx.payment.create({
        data: {
          companyId,
          paymentNumber,
          direction,
          businessPartnerId: partner.id,
          paymentDate,
          bankCashAccountId: bankCashAccount.id,
          currencyCode: company.baseCurrencyCode,
          exchangeRateToFunctional: paymentRate,
          amount,
          allocatedAmount: totalAllocated,
          unallocatedAmount: unallocated,
          reference: dto.reference,
          memo: dto.memo,
          status: PaymentStatus.POSTED,
          createdByUserId: userId,
          allocations: {
            create: loaded.map((l) => ({
              companyId,
              salesInvoiceId: direction === PaymentDirection.INCOMING ? l.invoiceId : null,
              purchaseInvoiceId: direction === PaymentDirection.OUTGOING ? l.invoiceId : null,
              allocatedAmount: l.amount,
            })),
          },
        },
      });

      const journalEntry = await this.glPostingService.createPostedEntry(tx, {
        companyId,
        userId,
        postingDate: paymentDate,
        documentDate: paymentDate,
        currencyCode: company.baseCurrencyCode,
        exchangeRateToFunctional: paymentRate,
        sourceModule: direction === PaymentDirection.INCOMING ? JournalSourceModule.AR : JournalSourceModule.AP,
        sourceDocumentId: created.id,
        memo: dto.memo ?? (direction === PaymentDirection.INCOMING ? "Incoming payment" : "Outgoing payment"),
        lines: glLines,
      });

      const withJournal = await tx.payment.update({
        where: { id: created.id },
        data: { journalEntryId: journalEntry.id },
        include: { allocations: true },
      });

      // Update each invoice's settlement fields and status.
      for (const l of loaded) {
        if (direction === PaymentDirection.INCOMING) {
          const invoice = await tx.salesInvoice.findUniqueOrThrow({ where: { id: l.invoiceId } });
          const newPaid = invoice.paidAmount.add(l.amount);
          const newOpen = invoice.openAmount.sub(l.amount);
          await tx.salesInvoice.update({
            where: { id: l.invoiceId },
            data: {
              paidAmount: newPaid,
              openAmount: newOpen,
              status: newOpen.eq(0) ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID,
            },
          });
        } else {
          const invoice = await tx.purchaseInvoice.findUniqueOrThrow({ where: { id: l.invoiceId } });
          const newPaid = invoice.paidAmount.add(l.amount);
          const newOpen = invoice.openAmount.sub(l.amount);
          await tx.purchaseInvoice.update({
            where: { id: l.invoiceId },
            data: {
              paidAmount: newPaid,
              openAmount: newOpen,
              status: newOpen.eq(0) ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID,
            },
          });
        }
      }

      return withJournal;
    });

    await this.auditService.log({
      companyId,
      entityName: "Payment",
      entityId: payment.id,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: payment,
    });

    return payment;
  }

  /**
   * Cancels a posted payment: reverses its JE, restores each allocated
   * invoice's paid/open amounts and status, deletes the allocation rows
   * (their before-state goes to the audit log), and marks the payment
   * CANCELLED — one transaction.
   */
  async cancelPayment(companyId: string, paymentId: string, userId: string) {
    const before = await this.getOwnedPayment(companyId, paymentId);
    if (before.status !== PaymentStatus.POSTED) {
      throw new ConflictException("Only posted payments can be cancelled");
    }

    const cancelled = await this.prisma.$transaction(async (tx) => {
      if (before.journalEntryId) {
        await this.glPostingService.reverseEntryInTx(tx, companyId, before.journalEntryId, userId);
      }

      for (const alloc of before.allocations) {
        if (alloc.salesInvoiceId) {
          const invoice = await tx.salesInvoice.findUniqueOrThrow({ where: { id: alloc.salesInvoiceId } });
          const newPaid = invoice.paidAmount.sub(alloc.allocatedAmount);
          const newOpen = invoice.openAmount.add(alloc.allocatedAmount);
          await tx.salesInvoice.update({
            where: { id: invoice.id },
            data: {
              paidAmount: newPaid,
              openAmount: newOpen,
              status: newPaid.eq(0) ? InvoiceStatus.POSTED : InvoiceStatus.PARTIALLY_PAID,
            },
          });
        }
        if (alloc.purchaseInvoiceId) {
          const invoice = await tx.purchaseInvoice.findUniqueOrThrow({ where: { id: alloc.purchaseInvoiceId } });
          const newPaid = invoice.paidAmount.sub(alloc.allocatedAmount);
          const newOpen = invoice.openAmount.add(alloc.allocatedAmount);
          await tx.purchaseInvoice.update({
            where: { id: invoice.id },
            data: {
              paidAmount: newPaid,
              openAmount: newOpen,
              status: newPaid.eq(0) ? InvoiceStatus.POSTED : InvoiceStatus.PARTIALLY_PAID,
            },
          });
        }
      }

      await tx.paymentAllocation.deleteMany({ where: { paymentId } });

      return tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.CANCELLED,
          allocatedAmount: new Prisma.Decimal(0),
          unallocatedAmount: before.amount,
          cancelledByUserId: userId,
          cancelledAt: new Date(),
        },
      });
    });

    await this.auditService.log({
      companyId,
      entityName: "Payment",
      entityId: paymentId,
      action: "REVERSE",
      changedByUserId: userId,
      beforeSnapshot: before,
      afterSnapshot: cancelled,
    });

    return cancelled;
  }

  async list(companyId: string, filters: { direction?: PaymentDirection; status?: PaymentStatus }) {
    return this.prisma.payment.findMany({
      where: {
        companyId,
        ...(filters.direction ? { direction: filters.direction } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        allocations: true,
        businessPartner: { select: { code: true, name: true } },
        bankCashAccount: { select: { code: true, name: true } },
      },
    });
  }

  async get(companyId: string, paymentId: string) {
    return this.getOwnedPayment(companyId, paymentId);
  }

  private async getOwnedPayment(companyId: string, paymentId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, companyId },
      include: { allocations: true, businessPartner: true },
    });
    if (!payment) {
      throw new NotFoundException("Payment not found");
    }
    return payment;
  }

  private async resolveExchangeRate(
    tx: Prisma.TransactionClient,
    companyId: string,
    currencyCode: string,
    baseCurrencyCode: string,
    rateDate: Date,
  ): Promise<Prisma.Decimal> {
    if (currencyCode === baseCurrencyCode) {
      return new Prisma.Decimal(1);
    }
    const rate = await tx.exchangeRate.findFirst({
      where: { companyId, fromCurrencyCode: currencyCode, toCurrencyCode: baseCurrencyCode, rateDate: { lte: rateDate } },
      orderBy: { rateDate: "desc" },
    });
    if (!rate) {
      throw new BadRequestException(`No exchange rate found from ${currencyCode} to ${baseCurrencyCode}`);
    }
    return rate.rate;
  }
}
