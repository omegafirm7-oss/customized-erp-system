import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PaymentDirection, PaymentStatus } from "@prisma/client";
import { PERMISSIONS } from "@erp/shared-constants";
import { Permissions } from "../common/decorators/permissions.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types/jwt-payload.type";
import { PaymentsService } from "./payments.service";
import { CreatePaymentDto } from "./dto/create-payment.dto";

// JwtAuthGuard + PermissionsGuard are registered globally in AppModule.
@ApiTags("payments")
@ApiBearerAuth()
@Controller("payments")
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  @Permissions(PERMISSIONS.PAYMENT_VIEW)
  async list(
    @CurrentCompanyId() companyId: string,
    @Query("direction") direction?: PaymentDirection,
    @Query("status") status?: PaymentStatus,
  ) {
    return this.paymentsService.list(companyId, { direction, status });
  }

  @Get(":id")
  @Permissions(PERMISSIONS.PAYMENT_VIEW)
  async get(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.paymentsService.get(companyId, id);
  }

  @Post("incoming")
  @Permissions(PERMISSIONS.PAYMENT_CREATE)
  async createIncoming(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.paymentsService.createPayment(companyId, user.sub, PaymentDirection.INCOMING, dto);
  }

  @Post("outgoing")
  @Permissions(PERMISSIONS.PAYMENT_CREATE)
  async createOutgoing(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.paymentsService.createPayment(companyId, user.sub, PaymentDirection.OUTGOING, dto);
  }

  @Post(":id/cancel")
  @Permissions(PERMISSIONS.PAYMENT_CANCEL)
  async cancel(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.paymentsService.cancelPayment(companyId, id, user.sub);
  }
}
