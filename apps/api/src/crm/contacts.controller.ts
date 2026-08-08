import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { MODULE_KEYS, PERMISSIONS } from "@erp/shared-constants";
import { Permissions } from "../common/decorators/permissions.decorator";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types/jwt-payload.type";
import { ContactsService } from "./contacts.service";
import { CreateContactDto } from "./dto/create-contact.dto";
import { UpdateContactDto } from "./dto/update-contact.dto";

@ApiTags("crm-contacts")
@ApiBearerAuth()
@Controller("crm/contacts")
@RequiresModule(MODULE_KEYS.CRM)
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get()
  @Permissions(PERMISSIONS.CRM_CONTACT_MANAGE)
  async list(@CurrentCompanyId() companyId: string, @Query("businessPartnerId") businessPartnerId?: string) {
    return this.contactsService.list(companyId, businessPartnerId);
  }

  @Post()
  @Permissions(PERMISSIONS.CRM_CONTACT_MANAGE)
  async create(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Body() dto: CreateContactDto) {
    return this.contactsService.create(companyId, user.sub, dto);
  }

  @Patch(":id")
  @Permissions(PERMISSIONS.CRM_CONTACT_MANAGE)
  async update(
    @CurrentCompanyId() companyId: string,
    @Param("id") id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateContactDto,
  ) {
    return this.contactsService.update(companyId, id, user.sub, dto);
  }

  @Delete(":id")
  @Permissions(PERMISSIONS.CRM_CONTACT_MANAGE)
  async delete(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    await this.contactsService.delete(companyId, id, user.sub);
    return { success: true };
  }
}
