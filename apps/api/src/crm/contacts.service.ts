import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreateContactDto } from "./dto/create-contact.dto";
import { UpdateContactDto } from "./dto/update-contact.dto";

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(companyId: string, businessPartnerId?: string) {
    return this.prisma.contact.findMany({
      where: { companyId, ...(businessPartnerId ? { businessPartnerId } : {}) },
      orderBy: [{ isPrimary: "desc" }, { firstName: "asc" }],
    });
  }

  async get(companyId: string, id: string) {
    return this.getOwned(companyId, id);
  }

  async create(companyId: string, userId: string, dto: CreateContactDto) {
    if (dto.businessPartnerId) {
      await this.assertPartnerOwned(companyId, dto.businessPartnerId);
    }
    const contact = await this.prisma.contact.create({
      data: {
        companyId,
        businessPartnerId: dto.businessPartnerId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        jobTitle: dto.jobTitle,
        email: dto.email,
        phone: dto.phone,
        isPrimary: dto.isPrimary ?? false,
        notes: dto.notes,
        createdByUserId: userId,
      },
    });
    await this.auditService.log({
      companyId,
      entityName: "Contact",
      entityId: contact.id,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: contact,
    });
    return contact;
  }

  async update(companyId: string, id: string, userId: string, dto: UpdateContactDto) {
    const before = await this.getOwned(companyId, id);
    if (dto.businessPartnerId) {
      await this.assertPartnerOwned(companyId, dto.businessPartnerId);
    }
    const updated = await this.prisma.contact.update({
      where: { id },
      data: {
        businessPartnerId: dto.businessPartnerId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        jobTitle: dto.jobTitle,
        email: dto.email,
        phone: dto.phone,
        isPrimary: dto.isPrimary,
        notes: dto.notes,
      },
    });
    await this.auditService.log({
      companyId,
      entityName: "Contact",
      entityId: id,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: before,
      afterSnapshot: updated,
    });
    return updated;
  }

  async delete(companyId: string, id: string, userId: string) {
    const before = await this.getOwned(companyId, id);
    await this.prisma.contact.delete({ where: { id } });
    await this.auditService.log({
      companyId,
      entityName: "Contact",
      entityId: id,
      action: "DELETE",
      changedByUserId: userId,
      beforeSnapshot: before,
    });
  }

  private async getOwned(companyId: string, id: string) {
    const contact = await this.prisma.contact.findFirst({ where: { id, companyId } });
    if (!contact) {
      throw new NotFoundException("Contact not found");
    }
    return contact;
  }

  private async assertPartnerOwned(companyId: string, partnerId: string) {
    const partner = await this.prisma.businessPartner.findFirst({ where: { id: partnerId, companyId } });
    if (!partner) {
      throw new BadRequestException("Business partner not found");
    }
  }
}
