import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InvoiceStatus, PartnerType, PaymentDirection, Prisma, VatCategory } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { ApService } from "./ap.service";
import { PaymentsService } from "./payments.service";

const OPEN: InvoiceStatus[] = [InvoiceStatus.POSTED, InvoiceStatus.PARTIALLY_PAID];

export interface RecordExpenseInput {
  payeeId: string;
  date: string;
  supplierName: string;
  supplierVat?: string;
  receiptNumber: string;
  projectId?: string;
  accountId: string;
  description: string;
  /** What the person actually paid, VAT included. */
  amount: string;
  /** True only when a proper VAT invoice exists: then VAT is split out and claimed. Otherwise the full amount is cost. */
  hasVatInvoice: boolean;
  /** Post straight away (needs the post permission). Otherwise left as a draft for review. */
  post: boolean;
}

/**
 * Money that directors, project managers and supervisors pay out of their own pocket for the company.
 *
 * Each person is a vendor-type business partner flagged as a staff payee. Their expenses are ordinary purchase
 * invoices in their name (so project cost, VAT and evidence all work exactly as for any supplier invoice), and
 * what the company owes them is their open payable balance. Repaying them is an ordinary outgoing payment
 * allocated against those invoices — it clears the liability and never counts as a second cost.
 */
@Injectable()
export class ReimbursementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly apService: ApService,
    private readonly paymentsService: PaymentsService,
  ) {}

  async createPayee(companyId: string, name: string, role: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException("Name is required");
    const existing = await this.prisma.businessPartner.findFirst({
      where: { companyId, isStaffPayee: true, name: { equals: trimmed, mode: "insensitive" } },
    });
    if (existing) throw new BadRequestException(`${existing.name} is already on the reimbursement list`);
    const count = await this.prisma.businessPartner.count({ where: { companyId, isStaffPayee: true } });
    let n = count + 1;
    // Codes are unique per company; skip any that are taken.
    while (await this.prisma.businessPartner.findUnique({ where: { companyId_code: { companyId, code: `STAFF-${String(n).padStart(3, "0")}` } } })) n++;
    return this.prisma.businessPartner.create({
      data: { companyId, code: `STAFF-${String(n).padStart(3, "0")}`, name: trimmed, partnerType: PartnerType.VENDOR, isStaffPayee: true, staffRole: role.trim() || null },
    });
  }

  /** Everyone who pays out of pocket, with what they have spent, been repaid and are still owed. */
  async listPayees(companyId: string) {
    const payees = await this.prisma.businessPartner.findMany({
      where: { companyId, isStaffPayee: true, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true, staffRole: true },
    });
    const totals = await this.prisma.purchaseInvoice.groupBy({
      by: ["businessPartnerId"],
      where: { companyId, status: { in: [...OPEN, InvoiceStatus.PAID] }, businessPartnerId: { in: payees.map((p) => p.id) } },
      _sum: { grossTotal: true, paidAmount: true, openAmount: true },
    });
    const drafts = await this.prisma.purchaseInvoice.groupBy({
      by: ["businessPartnerId"],
      where: { companyId, status: InvoiceStatus.DRAFT, businessPartnerId: { in: payees.map((p) => p.id) } },
      _count: true,
    });
    return payees.map((p) => {
      const t = totals.find((x) => x.businessPartnerId === p.id)?._sum;
      return {
        ...p,
        spent: (t?.grossTotal ?? new Prisma.Decimal(0)).toFixed(2),
        repaid: (t?.paidAmount ?? new Prisma.Decimal(0)).toFixed(2),
        owed: (t?.openAmount ?? new Prisma.Decimal(0)).toFixed(2),
        draftCount: drafts.find((d) => d.businessPartnerId === p.id)?._count ?? 0,
      };
    });
  }

  /** Every expense a person has paid for the company: project, supplier, VAT, how much is repaid and still owed. */
  async statement(companyId: string, payeeId: string) {
    const payee = await this.getPayee(companyId, payeeId);
    const invoices = await this.prisma.purchaseInvoice.findMany({
      where: { companyId, businessPartnerId: payee.id, status: { not: InvoiceStatus.CANCELLED } },
      orderBy: { postingDate: "desc" },
      include: {
        lines: { select: { id: true, description: true, project: { select: { code: true, name: true } }, expenseAccount: { select: { code: true, name: true } }, attachment: { select: { filename: true } } } },
      },
    });
    const rows = invoices.map((i) => ({
      id: i.id,
      date: i.postingDate,
      receiptNumber: i.vendorInvoiceNumber,
      supplierName: i.reimbursementSupplierName,
      supplierVat: i.reimbursementSupplierVat,
      status: i.status,
      net: i.netTotal.toFixed(2),
      vat: i.vatTotal.toFixed(2),
      gross: i.grossTotal.toFixed(2),
      repaid: i.paidAmount.toFixed(2),
      owed: i.status === InvoiceStatus.DRAFT ? "0.00" : i.openAmount.toFixed(2),
      lines: i.lines.map((l) => ({
        id: l.id,
        description: l.description,
        project: l.project ? `${l.project.code} — ${l.project.name}` : null,
        account: `${l.expenseAccount.code} — ${l.expenseAccount.name}`,
        hasEvidence: !!l.attachment,
      })),
    }));
    const sum = (f: (r: (typeof rows)[number]) => string) => rows.reduce((s, r) => s.add(f(r)), new Prisma.Decimal(0)).toFixed(2);
    const live = rows.filter((r) => r.status !== InvoiceStatus.DRAFT);
    return {
      payee: { id: payee.id, code: payee.code, name: payee.name, staffRole: payee.staffRole },
      spent: live.reduce((s, r) => s.add(r.gross), new Prisma.Decimal(0)).toFixed(2),
      repaid: sum((r) => r.repaid),
      owed: sum((r) => r.owed),
      rows,
    };
  }

  async recordExpense(companyId: string, userId: string, canPost: boolean, input: RecordExpenseInput) {
    const payee = await this.getPayee(companyId, input.payeeId);
    const amount = new Prisma.Decimal(input.amount);
    if (amount.lte(0)) throw new BadRequestException("Amount must be positive");
    if (!input.supplierName.trim()) throw new BadRequestException("Who was it bought from? Enter the supplier name");
    if (!input.receiptNumber.trim()) throw new BadRequestException("Enter the receipt or invoice number");
    if (input.hasVatInvoice && !input.supplierVat?.trim()) {
      throw new BadRequestException("VAT can only be claimed with the supplier's VAT number — enter it, or untick 'VAT invoice'");
    }
    if (input.post && !canPost) throw new BadRequestException("You can save this as a draft; posting needs the post permission");

    const draft = await this.apService.createDraft(companyId, userId, {
      businessPartnerId: payee.id,
      vendorInvoiceNumber: input.receiptNumber.trim(),
      postingDate: input.date,
      dueDate: input.date,
      memo: `Paid by ${payee.name}${payee.staffRole ? ` (${payee.staffRole})` : ""} — to reimburse. Supplier: ${input.supplierName.trim()}`,
      lines: [
        {
          description: `${input.description.trim() || "Expense"} — ${input.supplierName.trim()}`,
          quantity: "1",
          unitPrice: amount.toFixed(4),
          // With a VAT invoice the 15% is carved out of the total and claimed; without one the whole amount is cost.
          vatCategory: input.hasVatInvoice ? VatCategory.STANDARD_15 : VatCategory.EXEMPT,
          taxMode: "INCLUSIVE",
          accountId: input.accountId,
          projectId: input.projectId || undefined,
        },
      ],
    } as any);
    await this.prisma.purchaseInvoice.update({
      where: { id: draft.id },
      data: {
        reimbursementSupplierName: input.supplierName.trim(),
        reimbursementSupplierVat: input.hasVatInvoice ? input.supplierVat!.trim() : null,
      },
    });
    if (input.post) await this.apService.postInvoice(companyId, draft.id, userId, false);
    return this.apService.get(companyId, draft.id);
  }

  /**
   * Repays a person. Pays the chosen invoices (default: all of their open ones, oldest first) up to the amount,
   * from a bank or cash account, as an ordinary outgoing payment.
   */
  async reimburse(
    companyId: string,
    userId: string,
    payeeId: string,
    input: { paymentDate: string; bankCashAccountId: string; amount?: string; invoiceIds?: string[]; reference?: string },
  ) {
    const payee = await this.getPayee(companyId, payeeId);
    const open = await this.prisma.purchaseInvoice.findMany({
      where: { companyId, businessPartnerId: payee.id, status: { in: OPEN }, ...(input.invoiceIds?.length ? { id: { in: input.invoiceIds } } : {}) },
      orderBy: { postingDate: "asc" },
    });
    if (open.length === 0) throw new BadRequestException(`Nothing is owed to ${payee.name}`);
    const owed = open.reduce((s, i) => s.add(i.openAmount), new Prisma.Decimal(0));
    const amount = input.amount ? new Prisma.Decimal(input.amount) : owed;
    if (amount.lte(0)) throw new BadRequestException("Amount must be positive");
    if (amount.gt(owed)) throw new BadRequestException(`That is more than the ${owed.toFixed(2)} owed to ${payee.name}`);
    let remaining = amount;
    const allocations: Array<{ invoiceId: string; amount: string }> = [];
    for (const inv of open) {
      if (remaining.lte(0)) break;
      const part = Prisma.Decimal.min(remaining, inv.openAmount);
      allocations.push({ invoiceId: inv.id, amount: part.toFixed(4) });
      remaining = remaining.sub(part);
    }
    return this.paymentsService.createPayment(companyId, userId, PaymentDirection.OUTGOING, {
      businessPartnerId: payee.id,
      paymentDate: input.paymentDate,
      bankCashAccountId: input.bankCashAccountId,
      amount: amount.toFixed(4),
      reference: input.reference,
      memo: `Reimbursement to ${payee.name}`,
      allocations,
    } as any);
  }

  private async getPayee(companyId: string, id: string) {
    const payee = await this.prisma.businessPartner.findFirst({ where: { id, companyId, isStaffPayee: true } });
    if (!payee) throw new NotFoundException("Reimbursement payee not found");
    return payee;
  }
}
