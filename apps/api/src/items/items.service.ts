import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { VatCategory } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { defaultCategoryForCountry, isCategoryAllowedForCountry } from "../finance/invoice-math";
import { CreateItemDto, UpdateItemDto } from "./dto/create-item.dto";
import { CreateUomDto } from "./dto/create-uom.dto";
import { CreateWarehouseDto } from "./dto/create-warehouse.dto";

@Injectable()
export class ItemsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Units of Measure ────────────────────────────────────────────────
  async listUoMs(companyId: string) {
    return this.prisma.unitOfMeasure.findMany({ where: { OR: [{ companyId }, { companyId: null }] }, orderBy: { code: "asc" } });
  }

  async createUoM(companyId: string, dto: CreateUomDto) {
    return this.prisma.unitOfMeasure.create({ data: { companyId, ...dto } });
  }

  // ── Items ────────────────────────────────────────────────────────────
  async listItems(companyId: string) {
    return this.prisma.item.findMany({ where: { companyId }, orderBy: { code: "asc" }, include: { baseUoM: true } });
  }

  async getItem(companyId: string, id: string) {
    const item = await this.prisma.item.findFirst({ where: { id, companyId }, include: { baseUoM: true } });
    if (!item) {
      throw new NotFoundException("Item not found");
    }
    return item;
  }

  async createItem(companyId: string, dto: CreateItemDto) {
    const existing = await this.prisma.item.findUnique({ where: { companyId_code: { companyId, code: dto.code } } });
    if (existing) {
      throw new ConflictException(`Item code "${dto.code}" already exists`);
    }
    const countryCode = await this.getCountryCode(companyId);
    const vatCategory = dto.vatCategory ?? defaultCategoryForCountry(countryCode);
    this.validateTaxFields(countryCode, { ...dto, vatCategory });
    return this.prisma.item.create({ data: { companyId, ...dto, vatCategory } });
  }

  async updateItem(companyId: string, id: string, dto: UpdateItemDto) {
    const item = await this.getItem(companyId, id);
    const countryCode = await this.getCountryCode(companyId);
    this.validateTaxFields(countryCode, {
      vatCategory: dto.vatCategory ?? item.vatCategory,
      reducedRate: dto.reducedRate ?? item.reducedRate?.toString(),
      retailPrice: dto.retailPrice ?? item.retailPrice?.toString(),
    });
    return this.prisma.item.update({ where: { id: item.id }, data: dto, include: { baseUoM: true } });
  }

  private async getCountryCode(companyId: string) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { countryCode: true } });
    return company.countryCode;
  }

  /** Category must belong to the company's country; PK reduced/3rd-schedule need their driver values. */
  private validateTaxFields(
    countryCode: string,
    fields: { vatCategory: VatCategory; reducedRate?: string | null; retailPrice?: string | null },
  ) {
    if (!isCategoryAllowedForCountry(fields.vatCategory, countryCode)) {
      throw new BadRequestException(`Tax category ${fields.vatCategory} is not valid for a ${countryCode} company`);
    }
    if (fields.vatCategory === VatCategory.PK_REDUCED) {
      const rate = Number(fields.reducedRate);
      if (!fields.reducedRate || !(rate > 0 && rate < 18)) {
        throw new BadRequestException("Reduced-rate items need a reduced rate between 0 and 18%");
      }
    }
    if (fields.vatCategory === VatCategory.PK_THIRD_SCHEDULE && !(Number(fields.retailPrice) > 0)) {
      throw new BadRequestException("Third Schedule items need the printed retail price");
    }
  }

  async deactivateItem(companyId: string, id: string) {
    const item = await this.getItem(companyId, id);
    return this.prisma.item.update({ where: { id: item.id }, data: { isActive: false } });
  }

  // ── Warehouses ───────────────────────────────────────────────────────
  async listWarehouses(companyId: string) {
    return this.prisma.warehouse.findMany({ where: { companyId }, orderBy: { code: "asc" } });
  }

  async createWarehouse(companyId: string, dto: CreateWarehouseDto) {
    return this.prisma.warehouse.create({ data: { companyId, ...dto } });
  }
}
