import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { UpdateHrSettingsDto } from "./dto/hr.dtos";

type TxClient = Prisma.TransactionClient;

@Injectable()
export class HrSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async get(companyId: string) {
    const settings = await this.prisma.hrSettings.findUnique({ where: { companyId } });
    if (!settings) {
      throw new NotFoundException("HR settings not provisioned for this company");
    }
    return settings;
  }

  /** Tx-aware variant for payroll/termination posting paths. */
  async getInTx(tx: TxClient, companyId: string) {
    const settings = await tx.hrSettings.findUnique({ where: { companyId } });
    if (!settings) {
      throw new NotFoundException("HR settings not provisioned for this company");
    }
    return settings;
  }

  async update(companyId: string, userId: string, dto: UpdateHrSettingsDto) {
    const before = await this.get(companyId);
    const dec = (v?: string) => (v !== undefined ? new Prisma.Decimal(v) : undefined);
    const updated = await this.prisma.hrSettings.update({
      where: { companyId },
      data: {
        saudiEmployeeRatePct: dec(dto.saudiEmployeeRatePct),
        saudiEmployerRatePct: dec(dto.saudiEmployerRatePct),
        expatEmployerRatePct: dec(dto.expatEmployerRatePct),
        gosiWageFloor: dec(dto.gosiWageFloor),
        gosiWageCap: dec(dto.gosiWageCap),
        overtimeMultiplier: dec(dto.overtimeMultiplier),
        hoursPerDay: dec(dto.hoursPerDay),
        daysPerMonth: dec(dto.daysPerMonth),
        defaultAnnualLeaveDays: dec(dto.defaultAnnualLeaveDays),
        eosbBasis: dto.eosbBasis,
        settlementExcludesEosbAndLeave: dto.settlementExcludesEosbAndLeave,
        molEstablishmentId: dto.molEstablishmentId,
        employerBankCode: dto.employerBankCode,
        employerIban: dto.employerIban,
        updatedByUserId: userId,
      },
    });

    // Statutory rates feed every payroll computation — always audit changes.
    await this.auditService.log({
      companyId,
      entityName: "HrSettings",
      entityId: updated.id,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: before,
      afterSnapshot: updated,
    });

    return updated;
  }
}
