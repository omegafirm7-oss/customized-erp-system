import { Body, Controller, Get, Header, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZatcaEnvironment, ZatcaSubmissionStatus } from "@prisma/client";
import { IsEnum, IsOptional, IsString } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { PERMISSIONS } from "@erp/shared-constants";
import { Permissions } from "../common/decorators/permissions.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types/jwt-payload.type";
import { ZatcaDeviceService } from "./zatca-device.service";
import { ZatcaSubmissionService } from "./zatca-submission.service";

class CreateDeviceDto {
  @ApiProperty({ enum: ZatcaEnvironment })
  @IsEnum(ZatcaEnvironment)
  environment!: ZatcaEnvironment;

  @ApiProperty()
  @IsString()
  unitName!: string;

  @ApiProperty({ required: false, description: "Fatoora OTP; sandbox accepts any value" })
  @IsOptional()
  @IsString()
  otp?: string;
}

// JwtAuthGuard + PermissionsGuard are registered globally in AppModule.
@ApiTags("zatca")
@ApiBearerAuth()
@Controller("zatca")
export class ZatcaController {
  constructor(
    private readonly deviceService: ZatcaDeviceService,
    private readonly submissionService: ZatcaSubmissionService,
  ) {}

  // ── Devices ──────────────────────────────────────────────────────────

  @Get("devices")
  @Permissions(PERMISSIONS.ZATCA_DEVICE_MANAGE)
  async listDevices(@CurrentCompanyId() companyId: string) {
    return this.deviceService.listDevices(companyId);
  }

  @Get("devices/:id")
  @Permissions(PERMISSIONS.ZATCA_DEVICE_MANAGE)
  async getDevice(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.deviceService.getDevice(companyId, id);
  }

  @Post("devices")
  @Permissions(PERMISSIONS.ZATCA_DEVICE_MANAGE)
  async createDevice(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateDeviceDto,
  ) {
    return this.deviceService.createDevice(companyId, user.sub, dto);
  }

  @Post("devices/:id/compliance-checks")
  @Permissions(PERMISSIONS.ZATCA_DEVICE_MANAGE)
  async runComplianceChecks(
    @CurrentCompanyId() companyId: string,
    @Param("id") id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.deviceService.runComplianceChecks(companyId, id, user.sub);
  }

  @Post("devices/:id/activate")
  @Permissions(PERMISSIONS.ZATCA_DEVICE_MANAGE)
  async activate(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.deviceService.activate(companyId, id, user.sub);
  }

  @Post("devices/onboard")
  @Permissions(PERMISSIONS.ZATCA_DEVICE_MANAGE)
  async onboard(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateDeviceDto,
  ) {
    return this.deviceService.onboard(companyId, user.sub, dto);
  }

  // ── Submissions ──────────────────────────────────────────────────────

  @Get("submissions")
  @Permissions(PERMISSIONS.ZATCA_SUBMISSION_VIEW)
  async listSubmissions(@CurrentCompanyId() companyId: string, @Query("status") status?: ZatcaSubmissionStatus) {
    return this.submissionService.list(companyId, status);
  }

  @Get("submissions/:id")
  @Permissions(PERMISSIONS.ZATCA_SUBMISSION_VIEW)
  async getSubmission(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.submissionService.get(companyId, id);
  }

  @Post("submissions/:id/retry")
  @Permissions(PERMISSIONS.ZATCA_SUBMISSION_RETRY)
  async retry(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.submissionService.submit(companyId, id, user.sub);
  }

  @Get("submissions/:id/xml")
  @Permissions(PERMISSIONS.ZATCA_SUBMISSION_VIEW)
  @Header("Content-Type", "application/xml")
  async downloadXml(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    const { xml } = await this.submissionService.getDistributableXml(companyId, id);
    return xml;
  }
}
