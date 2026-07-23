import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PartnerType } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreateBusinessPartnerDto, UpdateBusinessPartnerDto } from "./dto/create-business-partner.dto";

/** Column order of the CSV import template — flat, matches CreateBusinessPartnerDto. */
const CSV_COLUMNS = [
  "code",
  "name",
  "nameAr",
  "partnerType",
  "taxRegistrationNumber",
  "commercialRegistrationNumber",
  "currencyCode",
] as const;

const CSV_SAMPLE_ROWS = [
  "V-001,Al Falak Trading Est.,مؤسسة الفلك التجارية,VENDOR,300012345600003,1010123456,SAR",
  "C-001,Red Dune Contracting Co.,شركة كثبان حمراء للمقاولات,CUSTOMER,300098765400003,1010987654,SAR",
];

export interface ImportRowError {
  row: number;
  message: string;
}

@Injectable()
export class PartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(companyId: string) {
    return this.prisma.businessPartner.findMany({ where: { companyId }, orderBy: { code: "asc" } });
  }

  async get(companyId: string, id: string) {
    const partner = await this.prisma.businessPartner.findFirst({ where: { id, companyId }, include: { addresses: true } });
    if (!partner) {
      throw new NotFoundException("Business partner not found");
    }
    return partner;
  }

  async create(companyId: string, dto: CreateBusinessPartnerDto) {
    const existing = await this.prisma.businessPartner.findUnique({
      where: { companyId_code: { companyId, code: dto.code } },
    });
    if (existing) {
      throw new ConflictException(`Business partner code "${dto.code}" already exists`);
    }
    return this.prisma.businessPartner.create({ data: { companyId, ...dto } });
  }

  async deactivate(companyId: string, id: string) {
    const partner = await this.get(companyId, id);
    return this.prisma.businessPartner.update({ where: { id: partner.id }, data: { isActive: false } });
  }

  async update(companyId: string, id: string, userId: string, dto: UpdateBusinessPartnerDto) {
    const partner = await this.get(companyId, id);
    if (dto.code && dto.code !== partner.code) {
      const clash = await this.prisma.businessPartner.findUnique({
        where: { companyId_code: { companyId, code: dto.code } },
      });
      if (clash) {
        throw new ConflictException(`Business partner code "${dto.code}" already exists`);
      }
    }
    const updated = await this.prisma.businessPartner.update({ where: { id: partner.id }, data: dto });
    await this.auditService.log({
      companyId,
      entityName: "BusinessPartner",
      entityId: partner.id,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: partner,
      afterSnapshot: updated,
    });
    return updated;
  }

  // ── CSV import ───────────────────────────────────────────────────────

  csvTemplate(): string {
    return [CSV_COLUMNS.join(","), ...CSV_SAMPLE_ROWS].join("\r\n") + "\r\n";
  }

  /**
   * All-or-nothing import: every row is validated and inserted in one
   * transaction; any error report aborts the whole file so a partial load
   * never needs manual cleanup. Mirrors employees.service.ts importCsv().
   */
  async importCsv(companyId: string, userId: string, csv: string) {
    const lines = csv
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length < 2) {
      throw new BadRequestException("CSV must contain a header row and at least one data row");
    }

    const header = lines[0].split(",").map((h) => h.trim());
    if (header.join(",") !== CSV_COLUMNS.join(",")) {
      throw new BadRequestException(`CSV header does not match the template. Expected: ${CSV_COLUMNS.join(",")}`);
    }

    const errors: ImportRowError[] = [];
    const rows: Array<Record<(typeof CSV_COLUMNS)[number], string>> = [];
    const seenCodes = new Set<string>();
    const partnerTypes = Object.values(PartnerType) as string[];

    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(",").map((c) => c.trim());
      if (cells.length !== CSV_COLUMNS.length) {
        errors.push({ row: i + 1, message: `Expected ${CSV_COLUMNS.length} columns, got ${cells.length}` });
        continue;
      }
      const row = Object.fromEntries(CSV_COLUMNS.map((col, idx) => [col, cells[idx]])) as Record<
        (typeof CSV_COLUMNS)[number],
        string
      >;
      if (!row.code) errors.push({ row: i + 1, message: "code is required" });
      if (!row.name) errors.push({ row: i + 1, message: "name is required" });
      if (!row.partnerType || !partnerTypes.includes(row.partnerType))
        errors.push({ row: i + 1, message: `partnerType must be one of ${partnerTypes.join(", ")}` });
      if (seenCodes.has(row.code)) {
        errors.push({ row: i + 1, message: `Duplicate code ${row.code} within the file` });
      }
      seenCodes.add(row.code);
      rows.push(row);
    }

    if (errors.length > 0) {
      return { imported: 0, errors };
    }

    const imported = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.businessPartner.findMany({
        where: { companyId, code: { in: rows.map((r) => r.code) } },
        select: { code: true },
      });
      if (existing.length > 0) {
        throw new BadRequestException(
          `Business partner code(s) already exist: ${existing.map((e) => e.code).join(", ")}`,
        );
      }

      const created: string[] = [];
      for (const row of rows) {
        const partner = await tx.businessPartner.create({
          data: {
            companyId,
            code: row.code,
            name: row.name,
            nameAr: row.nameAr || undefined,
            partnerType: row.partnerType as PartnerType,
            taxRegistrationNumber: row.taxRegistrationNumber || undefined,
            commercialRegistrationNumber: row.commercialRegistrationNumber || undefined,
            currencyCode: row.currencyCode || undefined,
          },
        });
        created.push(partner.id);
      }
      return created;
    });

    await this.auditService.log({
      companyId,
      entityName: "BusinessPartner",
      entityId: "csv-import",
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: { importedCount: imported.length, partnerIds: imported },
    });

    return { imported: imported.length, errors: [] as ImportRowError[] };
  }
}
