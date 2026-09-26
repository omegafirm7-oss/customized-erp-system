import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ControlAccountType, FbrSubmissionStatus, PartnerType, Prisma } from "@prisma/client";
import { randomBytes } from "crypto";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { hashPosKey } from "./pos-api-key.guard";
import { CreatePosTerminalDto, UpdatePosTerminalDto } from "./dto/pos.dto";

const PUBLIC_FIELDS = {
  id: true, code: true, name: true, fbrPosId: true, warehouseId: true, costCenterId: true,
  walkInPartnerId: true, cashAccountId: true, cardAccountId: true, apiKeyPrefix: true,
  isActive: true, lastUsedAt: true, createdAt: true,
} satisfies Prisma.PosTerminalSelect;

@Injectable()
export class PosTerminalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(companyId: string) {
    return this.prisma.posTerminal.findMany({ where: { companyId }, orderBy: { code: "asc" }, select: PUBLIC_FIELDS });
  }

  /** Returns the terminal plus its API key — the only time the key is ever shown. */
  async create(companyId: string, userId: string, dto: CreatePosTerminalDto) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    if (company.countryCode !== "PK") {
      throw new ConflictException("POS terminals report to FBR and are only available for Pakistan (PK) companies");
    }
    await this.validateRefs(companyId, dto);
    const existing = await this.prisma.posTerminal.findUnique({ where: { companyId_code: { companyId, code: dto.code } } });
    if (existing) throw new ConflictException(`Terminal code "${dto.code}" already exists`);

    const apiKey = generateKey();
    const terminal = await this.prisma.posTerminal.create({
      data: { companyId, ...dto, apiKeyHash: hashPosKey(apiKey), apiKeyPrefix: apiKey.slice(0, 12), createdByUserId: userId },
      select: PUBLIC_FIELDS,
    });
    await this.auditService.log({ companyId, entityName: "PosTerminal", entityId: terminal.id, action: "CREATE", changedByUserId: userId, afterSnapshot: terminal });
    return { ...terminal, apiKey };
  }

  async update(companyId: string, userId: string, id: string, dto: UpdatePosTerminalDto) {
    const before = await this.getOwned(companyId, id);
    await this.validateRefs(companyId, dto);
    const terminal = await this.prisma.posTerminal.update({ where: { id: before.id }, data: dto, select: PUBLIC_FIELDS });
    await this.auditService.log({ companyId, entityName: "PosTerminal", entityId: id, action: "UPDATE", changedByUserId: userId, afterSnapshot: terminal });
    return terminal;
  }

  /** Issues a new key; the old one stops working immediately. */
  async rotateKey(companyId: string, userId: string, id: string) {
    await this.getOwned(companyId, id);
    const apiKey = generateKey();
    const terminal = await this.prisma.posTerminal.update({
      where: { id },
      data: { apiKeyHash: hashPosKey(apiKey), apiKeyPrefix: apiKey.slice(0, 12) },
      select: PUBLIC_FIELDS,
    });
    await this.auditService.log({ companyId, entityName: "PosTerminal", entityId: id, action: "UPDATE", changedByUserId: userId, afterSnapshot: { rotatedKey: true, apiKeyPrefix: terminal.apiKeyPrefix } });
    return { ...terminal, apiKey };
  }

  /**
   * Per-terminal totals for a day (Pakistan date): what the till sold vs
   * what FBR has acknowledged — the daily reconciliation the retailer needs.
   */
  async dailySummary(companyId: string, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException("date must be YYYY-MM-DD");
    const terminals = await this.list(companyId);
    const sales = await this.prisma.posSale.findMany({
      where: { companyId, salesInvoice: { postingDate: new Date(`${date}T00:00:00Z`) } },
      select: {
        terminalId: true,
        invoiceType: true,
        posFee: true,
        salesInvoice: { select: { grossTotal: true, fbrSubmission: { select: { status: true } } } },
      },
    });
    return terminals.map((terminal) => {
      const own = sales.filter((s) => s.terminalId === terminal.id);
      const zero = new Prisma.Decimal(0);
      const signed = (s: (typeof own)[number]) => (s.invoiceType === 3 ? s.salesInvoice.grossTotal.neg() : s.salesInvoice.grossTotal);
      const acknowledged = own.filter((s) => s.salesInvoice.fbrSubmission?.status === FbrSubmissionStatus.VALID);
      return {
        terminal,
        transactions: own.length,
        netSales: own.reduce((sum, s) => sum.add(signed(s)), zero).toString(),
        posFees: own.reduce((sum, s) => sum.add(s.posFee), zero).toString(),
        fbrAcknowledged: acknowledged.length,
        fbrAcknowledgedAmount: acknowledged.reduce((sum, s) => sum.add(signed(s)), zero).toString(),
        fbrOutstanding: own.length - acknowledged.length,
      };
    });
  }

  /** Full terminal row for selling (cashier screen); must be active. */
  async getActive(companyId: string, id: string) {
    const terminal = await this.getOwned(companyId, id);
    if (!terminal.isActive) throw new ConflictException("This POS terminal is revoked");
    return terminal;
  }

  /** Terminals a cashier can sell through (no key material). */
  async listActive(companyId: string) {
    return this.prisma.posTerminal.findMany({
      where: { companyId, isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, fbrPosId: true },
    });
  }

  private async getOwned(companyId: string, id: string) {
    const terminal = await this.prisma.posTerminal.findFirst({ where: { id, companyId } });
    if (!terminal) throw new NotFoundException("POS terminal not found");
    return terminal;
  }

  private async validateRefs(
    companyId: string,
    refs: { walkInPartnerId?: string; cashAccountId?: string; cardAccountId?: string; warehouseId?: string; costCenterId?: string },
  ) {
    if (refs.walkInPartnerId) {
      const partner = await this.prisma.businessPartner.findFirst({ where: { id: refs.walkInPartnerId, companyId, isActive: true } });
      if (!partner || partner.partnerType === PartnerType.VENDOR) {
        throw new BadRequestException("Walk-in partner must be an active customer of this company");
      }
    }
    for (const accountId of [refs.cashAccountId, refs.cardAccountId]) {
      if (!accountId) continue;
      const account = await this.prisma.account.findFirst({ where: { id: accountId, companyId, isActive: true, isPostable: true } });
      if (!account || (account.controlAccountType !== ControlAccountType.CASH && account.controlAccountType !== ControlAccountType.BANK)) {
        throw new BadRequestException("Cash/card accounts must be postable cash or bank accounts of this company");
      }
    }
    if (refs.warehouseId && !(await this.prisma.warehouse.findFirst({ where: { id: refs.warehouseId, companyId, isActive: true } }))) {
      throw new BadRequestException("Warehouse not found in this company");
    }
    if (refs.costCenterId && !(await this.prisma.costCenter.findFirst({ where: { id: refs.costCenterId, companyId, isActive: true } }))) {
      throw new BadRequestException("Cost center not found in this company");
    }
  }
}

function generateKey() {
  return `pos_${randomBytes(32).toString("base64url")}`;
}
