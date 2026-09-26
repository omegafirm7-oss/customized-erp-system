import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types/jwt-payload.type";
import { IamService } from "./iam.service";

// JwtAuthGuard is registered globally in AppModule.
@ApiTags("iam")
@ApiBearerAuth()
@Controller("iam/me")
export class IamController {
  constructor(private readonly iamService: IamService) {}

  @Get("companies")
  async myCompanies(@CurrentUser() user: JwtPayload) {
    const memberships = await this.iamService.getCompanyMemberships(user.sub);
    return memberships.map((m) => ({
      companyId: m.companyId,
      companyCode: m.company.code,
      companyName: m.company.legalName,
      // Drives country-specific UI (tax categories, FBR vs ZATCA screens).
      countryCode: m.company.countryCode,
      baseCurrencyCode: m.company.baseCurrencyCode,
      enabledModules: m.company.enabledModules,
      roleName: m.role.name,
      isDefault: m.isDefault,
    }));
  }
}
