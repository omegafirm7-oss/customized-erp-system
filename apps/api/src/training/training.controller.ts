import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { Response } from "express";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { TrainingBatchStatus } from "@prisma/client";
import { MODULE_KEYS, PERMISSIONS } from "@erp/shared-constants";
import { Permissions } from "../common/decorators/permissions.decorator";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types/jwt-payload.type";
import { TrainingService } from "./training.service";
import {
  CreateBatchDto,
  CreateCourseDto,
  CreateTraineeDto,
  EnrollTraineesDto,
  IssueCertificatesDto,
  RevokeCertificateDto,
  SaveAttendanceDto,
  SaveMarksDto,
  UpdateBatchDto,
  UpdateCertificateDto,
  UpdateCourseDto,
  UpdateTraineeDto,
  UpdateTrainingSettingsDto,
} from "./dto/training.dtos";

// JwtAuthGuard + PermissionsGuard + ModuleEntitlementGuard are global (AppModule).
@ApiTags("training")
@ApiBearerAuth()
@Controller("training")
@RequiresModule(MODULE_KEYS.TRAINING)
export class TrainingController {
  constructor(private readonly training: TrainingService) {}

  @Get("dashboard")
  @Permissions(PERMISSIONS.TRAINING_VIEW)
  dashboard(@CurrentCompanyId() companyId: string) {
    return this.training.dashboard(companyId);
  }

  @Get("settings")
  @Permissions(PERMISSIONS.TRAINING_VIEW)
  getSettings(@CurrentCompanyId() companyId: string) {
    return this.training.getSettings(companyId);
  }

  @Patch("settings")
  @Permissions(PERMISSIONS.TRAINING_MANAGE)
  updateSettings(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdateTrainingSettingsDto) {
    return this.training.updateSettings(companyId, user.sub, dto);
  }

  @Get("employers")
  @Permissions(PERMISSIONS.TRAINING_VIEW)
  employers(@CurrentCompanyId() companyId: string) {
    return this.training.listEmployers(companyId);
  }

  // ── Courses ──
  @Get("courses")
  @Permissions(PERMISSIONS.TRAINING_VIEW)
  listCourses(@CurrentCompanyId() companyId: string, @Query("includeInactive") includeInactive?: string) {
    return this.training.listCourses(companyId, includeInactive === "true");
  }

  @Post("courses")
  @Permissions(PERMISSIONS.TRAINING_MANAGE)
  createCourse(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Body() dto: CreateCourseDto) {
    return this.training.createCourse(companyId, user.sub, dto);
  }

  @Patch("courses/:id")
  @Permissions(PERMISSIONS.TRAINING_MANAGE)
  updateCourse(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateCourseDto) {
    return this.training.updateCourse(companyId, id, user.sub, dto);
  }

  @Delete("courses/:id")
  @Permissions(PERMISSIONS.TRAINING_MANAGE)
  async deleteCourse(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Param("id", ParseUUIDPipe) id: string) {
    await this.training.deleteCourse(companyId, id, user.sub);
    return { success: true };
  }

  // ── Trainees ──
  @Get("trainees")
  @Permissions(PERMISSIONS.TRAINING_VIEW)
  listTrainees(@CurrentCompanyId() companyId: string, @Query("q") q?: string, @Query("employerPartnerId") employerPartnerId?: string) {
    return this.training.listTrainees(companyId, q, employerPartnerId || undefined);
  }

  @Get("trainees/:id")
  @Permissions(PERMISSIONS.TRAINING_VIEW)
  getTrainee(@CurrentCompanyId() companyId: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.training.getTrainee(companyId, id);
  }

  @Post("trainees")
  @Permissions(PERMISSIONS.TRAINING_MANAGE)
  createTrainee(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Body() dto: CreateTraineeDto) {
    return this.training.createTrainee(companyId, user.sub, dto);
  }

  @Patch("trainees/:id")
  @Permissions(PERMISSIONS.TRAINING_MANAGE)
  updateTrainee(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateTraineeDto) {
    return this.training.updateTrainee(companyId, id, user.sub, dto);
  }

  @Delete("trainees/:id")
  @Permissions(PERMISSIONS.TRAINING_MANAGE)
  async deleteTrainee(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Param("id", ParseUUIDPipe) id: string) {
    await this.training.deleteTrainee(companyId, id, user.sub);
    return { success: true };
  }

  @Post("trainees/:id/photo")
  @Permissions(PERMISSIONS.TRAINING_MANAGE)
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } }))
  uploadPhoto(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException("No file uploaded");
    return this.training.setTraineePhoto(companyId, id, user.sub, file);
  }

  @Delete("trainees/:id/photo")
  @Permissions(PERMISSIONS.TRAINING_MANAGE)
  async deletePhoto(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Param("id", ParseUUIDPipe) id: string) {
    await this.training.deleteTraineePhoto(companyId, id, user.sub);
    return { success: true };
  }

  @Get("trainees/:id/photo")
  @Permissions(PERMISSIONS.TRAINING_VIEW)
  async getPhoto(@CurrentCompanyId() companyId: string, @Param("id", ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const photo = await this.training.getTraineePhoto(companyId, id);
    res.set({ "Content-Type": photo.mimeType, "Cache-Control": "no-cache" });
    return new StreamableFile(photo.data);
  }

  // ── Batches ──
  @Get("batches")
  @Permissions(PERMISSIONS.TRAINING_VIEW)
  listBatches(@CurrentCompanyId() companyId: string, @Query("status") status?: TrainingBatchStatus, @Query("courseId") courseId?: string) {
    const valid = status && Object.values(TrainingBatchStatus).includes(status) ? status : undefined;
    return this.training.listBatches(companyId, { status: valid, courseId: courseId || undefined });
  }

  @Get("batches/:id")
  @Permissions(PERMISSIONS.TRAINING_VIEW)
  getBatch(@CurrentCompanyId() companyId: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.training.getBatch(companyId, id);
  }

  @Post("batches")
  @Permissions(PERMISSIONS.TRAINING_MANAGE)
  createBatch(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Body() dto: CreateBatchDto) {
    return this.training.createBatch(companyId, user.sub, dto);
  }

  @Patch("batches/:id")
  @Permissions(PERMISSIONS.TRAINING_MANAGE)
  updateBatch(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateBatchDto) {
    return this.training.updateBatch(companyId, id, user.sub, dto);
  }

  @Delete("batches/:id")
  @Permissions(PERMISSIONS.TRAINING_MANAGE)
  async deleteBatch(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Param("id", ParseUUIDPipe) id: string) {
    await this.training.deleteBatch(companyId, id, user.sub);
    return { success: true };
  }

  @Post("batches/:id/enrollments")
  @Permissions(PERMISSIONS.TRAINING_MANAGE)
  enroll(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: EnrollTraineesDto) {
    return this.training.enroll(companyId, id, user.sub, dto);
  }

  @Delete("enrollments/:id")
  @Permissions(PERMISSIONS.TRAINING_MANAGE)
  async removeEnrollment(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Param("id", ParseUUIDPipe) id: string) {
    await this.training.removeEnrollment(companyId, id, user.sub);
    return { success: true };
  }

  @Put("batches/:id/attendance")
  @Permissions(PERMISSIONS.TRAINING_MANAGE)
  saveAttendance(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: SaveAttendanceDto) {
    return this.training.saveAttendance(companyId, id, user.sub, dto);
  }

  @Put("batches/:id/marks")
  @Permissions(PERMISSIONS.TRAINING_MANAGE)
  saveMarks(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: SaveMarksDto) {
    return this.training.saveMarks(companyId, id, user.sub, dto);
  }

  @Post("batches/:id/certificates")
  @Permissions(PERMISSIONS.TRAINING_MANAGE)
  issue(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: IssueCertificatesDto) {
    return this.training.issueCertificates(companyId, id, user.sub, dto);
  }

  // ── Certificates ──
  @Get("certificates")
  @Permissions(PERMISSIONS.TRAINING_VIEW)
  listCertificates(
    @CurrentCompanyId() companyId: string,
    @Query("status") status?: string,
    @Query("expiringWithinDays") expiringWithinDays?: string,
    @Query("q") q?: string,
    @Query("courseId") courseId?: string,
  ) {
    const days = expiringWithinDays ? Number(expiringWithinDays) : undefined;
    if (days != null && (!Number.isInteger(days) || days < 0 || days > 3650)) throw new BadRequestException("expiringWithinDays must be 0-3650");
    return this.training.listCertificates(companyId, { status, expiringWithinDays: days, q, courseId: courseId || undefined });
  }

  @Get("certificates/:id")
  @Permissions(PERMISSIONS.TRAINING_VIEW)
  getCertificate(@CurrentCompanyId() companyId: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.training.getCertificate(companyId, id);
  }

  @Patch("certificates/:id")
  @Permissions(PERMISSIONS.TRAINING_MANAGE)
  updateCertificate(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateCertificateDto) {
    return this.training.updateCertificate(companyId, id, user.sub, dto);
  }

  @Post("certificates/:id/revoke")
  @Permissions(PERMISSIONS.TRAINING_MANAGE)
  revoke(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: RevokeCertificateDto) {
    return this.training.revokeCertificate(companyId, id, user.sub, dto);
  }
}
