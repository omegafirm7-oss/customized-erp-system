import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { CreateItemDto } from "./dto/create-item.dto";
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
    return this.prisma.item.create({ data: { companyId, ...dto } });
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
