import { Injectable } from "@nestjs/common";
import { FbrSubmissionStatus, InvoiceStatus, Prisma, SalesDocumentKind, VatCategory } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { POS_PAYMENT_MODES } from "../fbr/fbr-constants";

const REPORTABLE: InvoiceStatus[] = [InvoiceStatus.POSTED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.PAID];
const ZERO = new Prisma.Decimal(0);

/** Pakistan-local calendar date (UTC+5, no DST) as YYYY-MM-DD. */
function pkDate(instant: Date): string {
  return new Date(instant.getTime() + 5 * 3600_000).toISOString().slice(0, 10);
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const asDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

/**
 * Owner's dashboard for a Pakistan retail/clinic company. Everything is
 * derived from posted sales documents (POS and back-office alike) keyed by
 * posting date — which for POS sales is the Pakistan-local sale date.
 * Returns count negative. "Treatments" = services-tax lines (PK_SERVICES),
 * "products" = everything else.
 */
@Injectable()
export class PosDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(companyId: string, now = new Date()) {
    const today = pkDate(now);
    const from14 = addDays(today, -13);
    const monthStart = `${today.slice(0, 7)}-01`;
    const rangeStart = monthStart < from14 ? monthStart : from14;

    const invoices = await this.prisma.salesInvoice.findMany({
      where: { companyId, status: { in: REPORTABLE }, postingDate: { gte: asDate(rangeStart), lte: asDate(today) } },
      select: {
        id: true,
        invoiceNumber: true,
        documentKind: true,
        postingDate: true,
        issueDateTime: true,
        grossTotal: true,
        vatTotal: true,
        furtherTaxTotal: true,
        buyerNameSnapshot: true,
        lines: { select: { description: true, quantity: true, vatCategory: true, grossAmount: true, vatAmount: true, furtherTaxAmount: true } },
        fbrSubmission: { select: { status: true, fbrInvoiceNumber: true, acknowledgedAt: true } },
        posSale: { select: { paymentMode: true, posFee: true, rawPayload: true } },
      },
      orderBy: { issueDateTime: "desc" },
    });

    const signOf = (inv: (typeof invoices)[number]) => (inv.documentKind === SalesDocumentKind.CREDIT_NOTE ? -1 : 1);
    const dayOf = (inv: (typeof invoices)[number]) => inv.postingDate.toISOString().slice(0, 10);

    // ── KPIs (today vs same weekday last week) ──
    const todays = invoices.filter((inv) => dayOf(inv) === today);
    const lastWeekDay = addDays(today, -7);
    const revenueOn = (day: string) =>
      invoices.filter((inv) => dayOf(inv) === day).reduce((s, inv) => s.add(inv.grossTotal.mul(signOf(inv))), ZERO);
    const sales = todays.filter((inv) => signOf(inv) === 1);
    const returns = todays.filter((inv) => signOf(inv) === -1);
    const revenueToday = revenueOn(today);
    const tender = (mode: number) =>
      todays.filter((inv) => inv.posSale?.paymentMode === mode).reduce((s, inv) => s.add(inv.grossTotal.mul(signOf(inv))), ZERO);

    // ── 14-day revenue, treatments vs products ──
    const days = Array.from({ length: 14 }, (_, i) => addDays(from14, i)).map((date) => {
      let treatments = ZERO;
      let products = ZERO;
      for (const inv of invoices) {
        if (dayOf(inv) !== date) continue;
        for (const line of inv.lines) {
          const amount = line.grossAmount.mul(signOf(inv));
          if (line.vatCategory === VatCategory.PK_SERVICES) treatments = treatments.add(amount);
          else products = products.add(amount);
        }
      }
      return { date, treatments: treatments.toString(), products: products.toString() };
    });

    // ── FBR today ──
    const fbrCount = (status: FbrSubmissionStatus) => todays.filter((inv) => inv.fbrSubmission?.status === status).length;
    const settings = await this.prisma.fbrSettings.findUnique({ where: { companyId }, select: { enabled: true, environment: true } });
    const lastAck = await this.prisma.fbrSubmission.findFirst({
      where: { companyId, acknowledgedAt: { not: null } },
      orderBy: { acknowledgedAt: "desc" },
      select: { acknowledgedAt: true },
    });

    // ── Month-to-date tax + top treatments ──
    const month = invoices.filter((inv) => dayOf(inv) >= monthStart);
    let servicesTax = ZERO;
    let goodsTax = ZERO;
    let furtherTax = ZERO;
    const treatmentTotals = new Map<string, { quantity: Prisma.Decimal; amount: Prisma.Decimal }>();
    for (const inv of month) {
      const sign = signOf(inv);
      for (const line of inv.lines) {
        const salesTax = line.vatAmount.sub(line.furtherTaxAmount).mul(sign);
        furtherTax = furtherTax.add(line.furtherTaxAmount.mul(sign));
        if (line.vatCategory === VatCategory.PK_SERVICES) {
          servicesTax = servicesTax.add(salesTax);
          const entry = treatmentTotals.get(line.description) ?? { quantity: ZERO, amount: ZERO };
          entry.quantity = entry.quantity.add(line.quantity.mul(sign));
          entry.amount = entry.amount.add(line.grossAmount.mul(sign));
          treatmentTotals.set(line.description, entry);
        } else {
          goodsTax = goodsTax.add(salesTax);
        }
      }
    }
    const posFees = month.reduce((s, inv) => s.add(inv.posSale?.posFee ?? ZERO), ZERO);
    const topTreatments = [...treatmentTotals.entries()]
      .filter(([, t]) => t.amount.gt(0))
      .sort((a, b) => b[1].amount.comparedTo(a[1].amount))
      .slice(0, 5)
      .map(([name, t]) => ({ name, quantity: t.quantity.toString(), amount: t.amount.toString() }));

    // ── Recent sales ──
    const recentSales = invoices.slice(0, 8).map((inv) => {
      const buyer = (inv.posSale?.rawPayload as { buyer?: { name?: string } } | null)?.buyer;
      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        dateTime: inv.issueDateTime.toISOString(),
        patient: buyer?.name || inv.buyerNameSnapshot || "Walk-in",
        items: inv.lines.map((l) => (Number(l.quantity) === 1 ? l.description : `${l.description} ×${Number(l.quantity)}`)).join(", "),
        amount: inv.grossTotal.add(inv.posSale?.posFee ?? ZERO).mul(signOf(inv)).toString(),
        isReturn: signOf(inv) === -1,
        fbrStatus: inv.fbrSubmission?.status ?? null,
        fbrInvoiceNumber: inv.fbrSubmission?.fbrInvoiceNumber ?? null,
      };
    });

    return {
      today,
      kpis: {
        revenueToday: revenueToday.toString(),
        revenueSameDayLastWeek: revenueOn(lastWeekDay).toString(),
        billsToday: sales.length,
        returnsToday: returns.length,
        averageBill: sales.length ? sales.reduce((s, inv) => s.add(inv.grossTotal), ZERO).div(sales.length).toDecimalPlaces(2).toString() : "0",
        cashToday: tender(POS_PAYMENT_MODES.CASH).toString(),
        cardToday: tender(POS_PAYMENT_MODES.CARD).toString(),
      },
      days,
      fbr: {
        enabled: settings?.enabled ?? false,
        environment: settings?.environment ?? null,
        lastAcknowledgedAt: lastAck?.acknowledgedAt?.toISOString() ?? null,
        today: {
          total: todays.length,
          accepted: fbrCount(FbrSubmissionStatus.VALID),
          pending: fbrCount(FbrSubmissionStatus.PENDING),
          rejected: fbrCount(FbrSubmissionStatus.INVALID) + fbrCount(FbrSubmissionStatus.FAILED),
          notReported: todays.filter((inv) => !inv.fbrSubmission).length,
        },
      },
      monthTax: {
        services: servicesTax.toString(),
        goods: goodsTax.toString(),
        furtherTax: furtherTax.toString(),
        posFees: posFees.toString(),
        total: servicesTax.add(goodsTax).add(furtherTax).toString(),
      },
      recentSales,
      topTreatments,
    };
  }
}
