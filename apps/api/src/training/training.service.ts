import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, TrainingBatchStatus, TrainingCertificateStatus, TrainingResult } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
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
import { addMonthsUtc, batchDayList, computeResult, formatSerial, parseDateOnly, toDateOnly } from "./training-rules";

const MAX_BATCH_DAYS = 60;
const DAY_MS = 86400000;

// Every trainee read leaves out the photo bytes; the photo has its own route.
const TRAINEE_SELECT = {
  id: true,
  fullName: true,
  fullNameAr: true,
  idType: true,
  idNumber: true,
  nationality: true,
  phone: true,
  email: true,
  dateOfBirth: true,
  jobTitle: true,
  employerPartnerId: true,
  employerName: true,
  photoMimeType: true,
  notes: true,
  isActive: true,
  createdAt: true,
  employerPartner: { select: { id: true, code: true, name: true } },
} satisfies Prisma.TraineeSelect;

function todayUtc(): Date {
  return parseDateOnly(new Date().toISOString());
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** Effective certificate status shown to users: REVOKED, EXPIRED or VALID. */
export function effectiveCertificateStatus(cert: { status: TrainingCertificateStatus; expiryDate: Date }): "VALID" | "EXPIRED" | "REVOKED" {
  if (cert.status === TrainingCertificateStatus.REVOKED) return "REVOKED";
  return cert.expiryDate.getTime() < todayUtc().getTime() ? "EXPIRED" : "VALID";
}

@Injectable()
export class TrainingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Settings ──────────────────────────────────────────────────────────

  async getSettings(companyId: string) {
    return this.prisma.trainingSettings.upsert({ where: { companyId }, update: {}, create: { companyId } });
  }

  async updateSettings(companyId: string, userId: string, dto: UpdateTrainingSettingsDto) {
    const before = await this.getSettings(companyId);
    const updated = await this.prisma.trainingSettings.update({
      where: { companyId },
      data: {
        certificatePrefix: dto.certificatePrefix?.trim().toUpperCase(),
        signatoryName: dto.signatoryName,
        signatoryTitle: dto.signatoryTitle,
        certificateFooterText: dto.certificateFooterText,
      },
    });
    await this.audit.log({ companyId, entityName: "TrainingSettings", entityId: updated.id, action: "UPDATE", changedByUserId: userId, beforeSnapshot: before, afterSnapshot: updated });
    return updated;
  }

  // ── Dashboard ─────────────────────────────────────────────────────────

  async dashboard(companyId: string) {
    const today = todayUtc();
    const in30 = new Date(today.getTime() + 30 * DAY_MS);
    const in90 = new Date(today.getTime() + 90 * DAY_MS);
    const validWhere = { companyId, status: TrainingCertificateStatus.VALID };
    const [courses, trainees, upcomingBatches, runningBatches, validCerts, expiring30, expiring90, expired, nextBatches] = await Promise.all([
      this.prisma.trainingCourse.count({ where: { companyId, isActive: true } }),
      this.prisma.trainee.count({ where: { companyId, isActive: true } }),
      this.prisma.trainingBatch.count({ where: { companyId, status: TrainingBatchStatus.SCHEDULED, startDate: { gte: today } } }),
      this.prisma.trainingBatch.count({ where: { companyId, status: TrainingBatchStatus.IN_PROGRESS } }),
      this.prisma.trainingCertificate.count({ where: { ...validWhere, expiryDate: { gte: today } } }),
      this.prisma.trainingCertificate.count({ where: { ...validWhere, expiryDate: { gte: today, lte: in30 } } }),
      this.prisma.trainingCertificate.count({ where: { ...validWhere, expiryDate: { gte: today, lte: in90 } } }),
      this.prisma.trainingCertificate.count({ where: { ...validWhere, expiryDate: { lt: today } } }),
      this.prisma.trainingBatch.findMany({
        where: { companyId, status: { in: [TrainingBatchStatus.SCHEDULED, TrainingBatchStatus.IN_PROGRESS] }, endDate: { gte: today } },
        orderBy: { startDate: "asc" },
        take: 8,
        include: { course: { select: { code: true, name: true } }, _count: { select: { enrollments: true } } },
      }),
    ]);
    return { courses, trainees, upcomingBatches, runningBatches, validCerts, expiring30, expiring90, expired, nextBatches };
  }

  // ── Employers (customers) picker ──────────────────────────────────────

  async listEmployers(companyId: string) {
    return this.prisma.businessPartner.findMany({
      where: { companyId, isActive: true, partnerType: { in: ["CUSTOMER", "BOTH"] } },
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    });
  }

  // ── Courses ───────────────────────────────────────────────────────────

  async listCourses(companyId: string, includeInactive: boolean) {
    return this.prisma.trainingCourse.findMany({
      where: { companyId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      include: { _count: { select: { batches: true, certificates: true } } },
    });
  }

  async createCourse(companyId: string, userId: string, dto: CreateCourseDto) {
    try {
      const course = await this.prisma.trainingCourse.create({ data: { companyId, ...dto, code: dto.code.trim().toUpperCase() } });
      await this.audit.log({ companyId, entityName: "TrainingCourse", entityId: course.id, action: "CREATE", changedByUserId: userId, afterSnapshot: course });
      return course;
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(`A course with code ${dto.code} already exists`);
      throw err;
    }
  }

  async updateCourse(companyId: string, id: string, userId: string, dto: UpdateCourseDto) {
    const before = await this.getCourseOwned(companyId, id);
    try {
      const updated = await this.prisma.trainingCourse.update({
        where: { id },
        data: { ...dto, code: dto.code ? dto.code.trim().toUpperCase() : undefined },
      });
      await this.audit.log({ companyId, entityName: "TrainingCourse", entityId: id, action: "UPDATE", changedByUserId: userId, beforeSnapshot: before, afterSnapshot: updated });
      return updated;
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(`A course with code ${dto.code} already exists`);
      throw err;
    }
  }

  async deleteCourse(companyId: string, id: string, userId: string) {
    const before = await this.getCourseOwned(companyId, id);
    const batches = await this.prisma.trainingBatch.count({ where: { courseId: id } });
    if (batches > 0) {
      throw new ConflictException("This course has batches. Mark it inactive instead of deleting it.");
    }
    await this.prisma.trainingCourse.delete({ where: { id } });
    await this.audit.log({ companyId, entityName: "TrainingCourse", entityId: id, action: "DELETE", changedByUserId: userId, beforeSnapshot: before });
  }

  private async getCourseOwned(companyId: string, id: string) {
    const course = await this.prisma.trainingCourse.findFirst({ where: { id, companyId } });
    if (!course) throw new NotFoundException("Course not found");
    return course;
  }

  // ── Trainees ──────────────────────────────────────────────────────────

  async listTrainees(companyId: string, q?: string, employerPartnerId?: string) {
    const term = q?.trim();
    return this.prisma.trainee.findMany({
      where: {
        companyId,
        ...(employerPartnerId ? { employerPartnerId } : {}),
        ...(term
          ? {
              OR: [
                { fullName: { contains: term, mode: "insensitive" } },
                { idNumber: { contains: term, mode: "insensitive" } },
                { phone: { contains: term } },
                { employerName: { contains: term, mode: "insensitive" } },
                { employerPartner: { name: { contains: term, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      select: { ...TRAINEE_SELECT, _count: { select: { enrollments: true, certificates: true } } },
      orderBy: { fullName: "asc" },
      take: 1000,
    });
  }

  async getTrainee(companyId: string, id: string) {
    const trainee = await this.prisma.trainee.findFirst({
      where: { id, companyId },
      select: {
        ...TRAINEE_SELECT,
        enrollments: {
          orderBy: { createdAt: "desc" },
          include: {
            batch: { select: { id: true, batchNo: true, startDate: true, endDate: true, status: true, course: { select: { code: true, name: true } } } },
            certificate: { select: { id: true, certificateNo: true } },
          },
        },
        certificates: {
          orderBy: { issueDate: "desc" },
          include: { course: { select: { code: true, name: true } } },
        },
      },
    });
    if (!trainee) throw new NotFoundException("Trainee not found");
    return {
      ...trainee,
      certificates: trainee.certificates.map((c) => ({ ...c, effectiveStatus: effectiveCertificateStatus(c) })),
    };
  }

  async createTrainee(companyId: string, userId: string, dto: CreateTraineeDto) {
    if (dto.employerPartnerId) await this.assertCustomerOwned(companyId, dto.employerPartnerId);
    try {
      const trainee = await this.prisma.trainee.create({
        data: { companyId, ...dto, idNumber: dto.idNumber.trim(), dateOfBirth: dto.dateOfBirth ? parseDateOnly(dto.dateOfBirth) : undefined },
        select: TRAINEE_SELECT,
      });
      await this.audit.log({ companyId, entityName: "Trainee", entityId: trainee.id, action: "CREATE", changedByUserId: userId, afterSnapshot: trainee });
      return trainee;
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(`A trainee with ID number ${dto.idNumber} already exists`);
      throw err;
    }
  }

  async updateTrainee(companyId: string, id: string, userId: string, dto: UpdateTraineeDto) {
    const before = await this.getTraineeOwned(companyId, id);
    if (dto.employerPartnerId) await this.assertCustomerOwned(companyId, dto.employerPartnerId);
    try {
      const updated = await this.prisma.trainee.update({
        where: { id },
        data: {
          ...dto,
          idNumber: dto.idNumber?.trim(),
          dateOfBirth: dto.dateOfBirth === undefined ? undefined : dto.dateOfBirth ? parseDateOnly(dto.dateOfBirth) : null,
        },
        select: TRAINEE_SELECT,
      });
      await this.audit.log({ companyId, entityName: "Trainee", entityId: id, action: "UPDATE", changedByUserId: userId, beforeSnapshot: before, afterSnapshot: updated });
      return updated;
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(`A trainee with ID number ${dto.idNumber} already exists`);
      throw err;
    }
  }

  async deleteTrainee(companyId: string, id: string, userId: string) {
    const before = await this.getTraineeOwned(companyId, id);
    const enrollments = await this.prisma.trainingEnrollment.count({ where: { traineeId: id } });
    if (enrollments > 0) {
      throw new ConflictException("This trainee is enrolled in a batch. Mark them inactive instead of deleting.");
    }
    await this.prisma.trainee.delete({ where: { id } });
    await this.audit.log({ companyId, entityName: "Trainee", entityId: id, action: "DELETE", changedByUserId: userId, beforeSnapshot: before });
  }

  async setTraineePhoto(companyId: string, id: string, userId: string, file: Express.Multer.File) {
    await this.getTraineeOwned(companyId, id);
    if (!/^image\/(jpeg|png|webp)$/.test(file.mimetype)) {
      throw new BadRequestException("Photo must be a JPEG, PNG or WebP image");
    }
    await this.prisma.trainee.update({ where: { id }, data: { photo: file.buffer, photoMimeType: file.mimetype } });
    await this.audit.log({ companyId, entityName: "Trainee", entityId: id, action: "UPDATE", changedByUserId: userId, afterSnapshot: { photo: `${file.mimetype}, ${file.size} bytes` } });
    return { success: true };
  }

  async deleteTraineePhoto(companyId: string, id: string, userId: string) {
    await this.getTraineeOwned(companyId, id);
    await this.prisma.trainee.update({ where: { id }, data: { photo: null, photoMimeType: null } });
    await this.audit.log({ companyId, entityName: "Trainee", entityId: id, action: "UPDATE", changedByUserId: userId, afterSnapshot: { photo: null } });
  }

  async getTraineePhoto(companyId: string, id: string) {
    const t = await this.prisma.trainee.findFirst({ where: { id, companyId }, select: { photo: true, photoMimeType: true } });
    if (!t?.photo || !t.photoMimeType) throw new NotFoundException("No photo");
    return { data: Buffer.from(t.photo), mimeType: t.photoMimeType };
  }

  private async getTraineeOwned(companyId: string, id: string) {
    const t = await this.prisma.trainee.findFirst({ where: { id, companyId }, select: TRAINEE_SELECT });
    if (!t) throw new NotFoundException("Trainee not found");
    return t;
  }

  private async assertCustomerOwned(companyId: string, partnerId: string) {
    const p = await this.prisma.businessPartner.findFirst({ where: { id: partnerId, companyId }, select: { id: true } });
    if (!p) throw new BadRequestException("Employer not found in Partners");
  }

  // ── Batches ───────────────────────────────────────────────────────────

  async listBatches(companyId: string, filter: { status?: TrainingBatchStatus; courseId?: string }) {
    return this.prisma.trainingBatch.findMany({
      where: { companyId, ...(filter.status ? { status: filter.status } : {}), ...(filter.courseId ? { courseId: filter.courseId } : {}) },
      orderBy: { startDate: "desc" },
      include: {
        course: { select: { id: true, code: true, name: true } },
        _count: { select: { enrollments: true } },
        enrollments: { select: { result: true, certificate: { select: { id: true } } } },
      },
      take: 500,
    }).then((rows) =>
      rows.map(({ enrollments, ...b }) => ({
        ...b,
        passed: enrollments.filter((e) => e.result === TrainingResult.PASSED).length,
        certified: enrollments.filter((e) => e.certificate).length,
      })),
    );
  }

  async getBatch(companyId: string, id: string) {
    const batch = await this.prisma.trainingBatch.findFirst({
      where: { id, companyId },
      include: {
        course: true,
        enrollments: {
          orderBy: { trainee: { fullName: "asc" } },
          include: {
            trainee: { select: { id: true, fullName: true, idType: true, idNumber: true, phone: true, nationality: true, photoMimeType: true, employerName: true, employerPartner: { select: { id: true, name: true } } } },
            attendance: { select: { date: true, present: true } },
            certificate: { select: { id: true, certificateNo: true, issueDate: true, expiryDate: true, status: true, externalCardNo: true, verifyToken: true } },
          },
        },
      },
    });
    if (!batch) throw new NotFoundException("Batch not found");
    return {
      ...batch,
      days: batchDayList(batch.startDate, batch.endDate),
      enrollments: batch.enrollments.map((e) => ({
        ...e,
        attendance: e.attendance.map((a) => ({ date: toDateOnly(a.date), present: a.present })),
      })),
    };
  }

  async createBatch(companyId: string, userId: string, dto: CreateBatchDto) {
    const course = await this.getCourseOwned(companyId, dto.courseId);
    if (!course.isActive) throw new BadRequestException("This course is inactive");
    const { start, end } = this.validateBatchDates(dto.startDate, dto.endDate);
    const batch = await this.prisma.$transaction(async (tx) => {
      await tx.trainingSettings.upsert({ where: { companyId }, update: {}, create: { companyId } });
      // The increment takes a row lock held until commit, so concurrent
      // creates get distinct numbers.
      const settings = await tx.trainingSettings.update({ where: { companyId }, data: { nextBatchNumber: { increment: 1 } } });
      const batchNo = formatSerial("BATCH", start.getUTCFullYear(), settings.nextBatchNumber - 1);
      return tx.trainingBatch.create({
        data: { companyId, batchNo, courseId: course.id, startDate: start, endDate: end, venue: dto.venue, instructorName: dto.instructorName, capacity: dto.capacity, notes: dto.notes },
      });
    });
    await this.audit.log({ companyId, entityName: "TrainingBatch", entityId: batch.id, action: "CREATE", changedByUserId: userId, afterSnapshot: batch });
    return batch;
  }

  async updateBatch(companyId: string, id: string, userId: string, dto: UpdateBatchDto) {
    const before = await this.getBatchOwned(companyId, id);
    if (dto.courseId && dto.courseId !== before.courseId) {
      const enrolled = await this.prisma.trainingEnrollment.count({ where: { batchId: id } });
      if (enrolled > 0) throw new ConflictException("Remove the enrolled trainees before changing the course of a batch");
      await this.getCourseOwned(companyId, dto.courseId);
    }
    const { start, end } = this.validateBatchDates(dto.startDate ?? toDateOnly(before.startDate), dto.endDate ?? toDateOnly(before.endDate));
    if (dto.capacity != null) {
      const enrolled = await this.prisma.trainingEnrollment.count({ where: { batchId: id } });
      if (enrolled > dto.capacity) throw new BadRequestException(`${enrolled} trainees are already enrolled; capacity can't be lower`);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      // Attendance outside the new date range no longer belongs to the batch.
      await tx.trainingAttendance.deleteMany({ where: { enrollment: { batchId: id }, OR: [{ date: { lt: start } }, { date: { gt: end } }] } });
      return tx.trainingBatch.update({
        where: { id },
        data: { courseId: dto.courseId, startDate: start, endDate: end, venue: dto.venue, instructorName: dto.instructorName, capacity: dto.capacity, notes: dto.notes, status: dto.status },
      });
    });
    await this.recomputeBatchResults(id);
    await this.audit.log({ companyId, entityName: "TrainingBatch", entityId: id, action: "UPDATE", changedByUserId: userId, beforeSnapshot: before, afterSnapshot: updated });
    return updated;
  }

  async deleteBatch(companyId: string, id: string, userId: string) {
    const before = await this.getBatchOwned(companyId, id);
    const certs = await this.prisma.trainingCertificate.count({ where: { enrollment: { batchId: id } } });
    if (certs > 0) throw new ConflictException("Certificates were issued from this batch; it can't be deleted. Cancel it instead.");
    await this.prisma.trainingBatch.delete({ where: { id } });
    await this.audit.log({ companyId, entityName: "TrainingBatch", entityId: id, action: "DELETE", changedByUserId: userId, beforeSnapshot: before });
  }

  private validateBatchDates(startStr: string, endStr: string) {
    const start = parseDateOnly(startStr);
    const end = parseDateOnly(endStr);
    if (end.getTime() < start.getTime()) throw new BadRequestException("End date is before the start date");
    if ((end.getTime() - start.getTime()) / DAY_MS + 1 > MAX_BATCH_DAYS) {
      throw new BadRequestException(`A batch can't be longer than ${MAX_BATCH_DAYS} days`);
    }
    return { start, end };
  }

  private async getBatchOwned(companyId: string, id: string) {
    const batch = await this.prisma.trainingBatch.findFirst({ where: { id, companyId } });
    if (!batch) throw new NotFoundException("Batch not found");
    return batch;
  }

  // ── Enrollment ────────────────────────────────────────────────────────

  async enroll(companyId: string, batchId: string, userId: string, dto: EnrollTraineesDto) {
    const batch = await this.getBatchOwned(companyId, batchId);
    if (batch.status === TrainingBatchStatus.CANCELLED || batch.status === TrainingBatchStatus.COMPLETED) {
      throw new BadRequestException(`Can't enrol trainees in a ${batch.status.toLowerCase()} batch`);
    }
    const ids = [...new Set(dto.traineeIds)];
    const trainees = await this.prisma.trainee.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, isActive: true, fullName: true } });
    if (trainees.length !== ids.length) throw new BadRequestException("One or more trainees were not found");
    const inactive = trainees.filter((t) => !t.isActive);
    if (inactive.length) throw new BadRequestException(`Inactive trainee(s): ${inactive.map((t) => t.fullName).join(", ")}`);

    const created = await this.prisma.$transaction(async (tx) => {
      // Lock the batch row so two concurrent enrolments can't both pass the capacity check.
      await tx.$queryRaw`SELECT id FROM "training_batches" WHERE id = ${batchId} FOR UPDATE`;
      const existing = await tx.trainingEnrollment.findMany({ where: { batchId }, select: { traineeId: true } });
      const existingSet = new Set(existing.map((e) => e.traineeId));
      const toAdd = ids.filter((id) => !existingSet.has(id));
      if (batch.capacity != null && existing.length + toAdd.length > batch.capacity) {
        throw new BadRequestException(`Only ${Math.max(batch.capacity - existing.length, 0)} seat(s) left in this batch`);
      }
      await tx.trainingEnrollment.createMany({ data: toAdd.map((traineeId) => ({ companyId, batchId, traineeId })) });
      return toAdd.length;
    });
    await this.audit.log({ companyId, entityName: "TrainingBatch", entityId: batchId, action: "UPDATE", changedByUserId: userId, afterSnapshot: { enrolled: created } });
    return { enrolled: created, alreadyEnrolled: ids.length - created };
  }

  async removeEnrollment(companyId: string, enrollmentId: string, userId: string) {
    const e = await this.prisma.trainingEnrollment.findFirst({ where: { id: enrollmentId, companyId }, include: { certificate: { select: { id: true } } } });
    if (!e) throw new NotFoundException("Enrollment not found");
    if (e.certificate) throw new ConflictException("A certificate was issued for this trainee; revoke it instead of removing them");
    await this.prisma.trainingEnrollment.delete({ where: { id: enrollmentId } });
    await this.audit.log({ companyId, entityName: "TrainingEnrollment", entityId: enrollmentId, action: "DELETE", changedByUserId: userId, beforeSnapshot: e });
  }

  // ── Attendance & marks ────────────────────────────────────────────────

  async saveAttendance(companyId: string, batchId: string, userId: string, dto: SaveAttendanceDto) {
    const batch = await this.getBatchOwned(companyId, batchId);
    const enrollmentIds = new Set(
      (await this.prisma.trainingEnrollment.findMany({ where: { batchId }, select: { id: true } })).map((e) => e.id),
    );
    const days = new Set(batchDayList(batch.startDate, batch.endDate));
    for (const entry of dto.entries) {
      if (!enrollmentIds.has(entry.enrollmentId)) throw new BadRequestException("Attendance entry for a trainee not in this batch");
      if (!days.has(entry.date.slice(0, 10))) throw new BadRequestException(`${entry.date} is outside the batch dates`);
    }
    await this.prisma.$transaction(
      dto.entries.map((entry) =>
        this.prisma.trainingAttendance.upsert({
          where: { enrollmentId_date: { enrollmentId: entry.enrollmentId, date: parseDateOnly(entry.date) } },
          update: { present: entry.present },
          create: { enrollmentId: entry.enrollmentId, date: parseDateOnly(entry.date), present: entry.present },
        }),
      ),
    );
    await this.recomputeBatchResults(batchId);
    await this.audit.log({ companyId, entityName: "TrainingBatch", entityId: batchId, action: "UPDATE", changedByUserId: userId, afterSnapshot: { attendanceEntries: dto.entries.length } });
    return this.getBatch(companyId, batchId);
  }

  async saveMarks(companyId: string, batchId: string, userId: string, dto: SaveMarksDto) {
    const batch = await this.prisma.trainingBatch.findFirst({ where: { id: batchId, companyId }, include: { course: true, enrollments: { select: { id: true, certificate: { select: { id: true } } } } } });
    if (!batch) throw new NotFoundException("Batch not found");
    const byId = new Map(batch.enrollments.map((e) => [e.id, e]));
    for (const entry of dto.entries) {
      const e = byId.get(entry.enrollmentId);
      if (!e) throw new BadRequestException("Marks entry for a trainee not in this batch");
      if (e.certificate) throw new ConflictException("Marks can't change after a certificate was issued; revoke it first");
      if (entry.theoryMarks != null && entry.theoryMarks > batch.course.theoryMaxMarks) {
        throw new BadRequestException(`Theory marks can't exceed ${batch.course.theoryMaxMarks}`);
      }
      if (entry.practicalMarks != null && entry.practicalMarks > batch.course.practicalMaxMarks) {
        throw new BadRequestException(`Practical marks can't exceed ${batch.course.practicalMaxMarks}`);
      }
    }
    await this.prisma.$transaction(
      dto.entries.map((entry) =>
        this.prisma.trainingEnrollment.update({
          where: { id: entry.enrollmentId },
          data: {
            theoryMarks: entry.theoryMarks === undefined ? undefined : entry.theoryMarks,
            practicalMarks: entry.practicalMarks === undefined ? undefined : entry.practicalMarks,
            remarks: entry.remarks,
            ...(entry.resultOverride === undefined
              ? {}
              : entry.resultOverride === null
                ? { resultOverride: false }
                : { resultOverride: true, result: entry.resultOverride }),
          },
        }),
      ),
    );
    await this.recomputeBatchResults(batchId);
    await this.audit.log({ companyId, entityName: "TrainingBatch", entityId: batchId, action: "UPDATE", changedByUserId: userId, afterSnapshot: { marks: dto.entries } });
    return this.getBatch(companyId, batchId);
  }

  /** Re-applies the automatic result rule to every non-overridden, uncertified enrollment of a batch. */
  private async recomputeBatchResults(batchId: string) {
    const batch = await this.prisma.trainingBatch.findUnique({
      where: { id: batchId },
      include: { course: true, enrollments: { include: { attendance: true, certificate: { select: { id: true } } } } },
    });
    if (!batch) return;
    const batchDays = batchDayList(batch.startDate, batch.endDate).length;
    const updates: Prisma.PrismaPromise<unknown>[] = [];
    for (const e of batch.enrollments) {
      if (e.resultOverride || e.certificate) continue;
      const result = computeResult({
        passMarkPercent: batch.course.passMarkPercent,
        theoryMaxMarks: batch.course.theoryMaxMarks,
        practicalMaxMarks: batch.course.practicalMaxMarks,
        minAttendancePercent: batch.course.minAttendancePercent,
        theoryMarks: e.theoryMarks == null ? null : Number(e.theoryMarks),
        practicalMarks: e.practicalMarks == null ? null : Number(e.practicalMarks),
        batchDays,
        attendance: e.attendance.length ? { present: e.attendance.filter((a) => a.present).length, recorded: e.attendance.length } : null,
      });
      if (result !== e.result) updates.push(this.prisma.trainingEnrollment.update({ where: { id: e.id }, data: { result } }));
    }
    if (updates.length) await this.prisma.$transaction(updates);
  }

  // ── Certificates ──────────────────────────────────────────────────────

  async issueCertificates(companyId: string, batchId: string, userId: string, dto: IssueCertificatesDto) {
    const batch = await this.prisma.trainingBatch.findFirst({
      where: { id: batchId, companyId },
      include: { course: true, enrollments: { include: { certificate: { select: { id: true } } } } },
    });
    if (!batch) throw new NotFoundException("Batch not found");
    if (batch.status === TrainingBatchStatus.CANCELLED) throw new BadRequestException("This batch was cancelled");
    const wanted = dto.enrollmentIds ? new Set(dto.enrollmentIds) : null;
    const eligible = batch.enrollments.filter((e) => e.result === TrainingResult.PASSED && !e.certificate && (!wanted || wanted.has(e.id)));
    if (wanted) {
      const notEligible = [...wanted].filter((id) => !eligible.some((e) => e.id === id));
      if (notEligible.length) throw new BadRequestException("Certificates can only be issued to passed trainees without one");
    }
    if (eligible.length === 0) throw new BadRequestException("No passed trainees are waiting for a certificate");

    const issueDate = dto.issueDate ? parseDateOnly(dto.issueDate) : batch.endDate;
    const expiryDate = addMonthsUtc(issueDate, batch.course.validityMonths);

    const issued = await this.prisma.$transaction(async (tx) => {
      await tx.trainingSettings.upsert({ where: { companyId }, update: {}, create: { companyId } });
      const settings = await tx.trainingSettings.update({ where: { companyId }, data: { nextCertificateNumber: { increment: eligible.length } } });
      const first = settings.nextCertificateNumber - eligible.length;
      const rows = [];
      for (let i = 0; i < eligible.length; i++) {
        const e = eligible[i];
        rows.push(
          await tx.trainingCertificate.create({
            data: {
              companyId,
              enrollmentId: e.id,
              traineeId: e.traineeId,
              courseId: batch.courseId,
              certificateNo: formatSerial(settings.certificatePrefix, issueDate.getUTCFullYear(), first + i),
              issueDate,
              expiryDate,
              issuedByUserId: userId,
            },
          }),
        );
      }
      return rows;
    });
    for (const c of issued) {
      await this.audit.log({ companyId, entityName: "TrainingCertificate", entityId: c.id, action: "POST", changedByUserId: userId, afterSnapshot: c });
    }
    return { issued: issued.length };
  }

  async listCertificates(companyId: string, filter: { status?: string; expiringWithinDays?: number; q?: string; courseId?: string }) {
    const today = todayUtc();
    const where: Prisma.TrainingCertificateWhereInput = { companyId };
    if (filter.courseId) where.courseId = filter.courseId;
    if (filter.status === "REVOKED") where.status = TrainingCertificateStatus.REVOKED;
    else if (filter.status === "EXPIRED") Object.assign(where, { status: TrainingCertificateStatus.VALID, expiryDate: { lt: today } });
    else if (filter.status === "VALID") Object.assign(where, { status: TrainingCertificateStatus.VALID, expiryDate: { gte: today } });
    if (filter.expiringWithinDays != null) {
      Object.assign(where, {
        status: TrainingCertificateStatus.VALID,
        expiryDate: { gte: today, lte: new Date(today.getTime() + filter.expiringWithinDays * DAY_MS) },
      });
    }
    const term = filter.q?.trim();
    if (term) {
      where.OR = [
        { certificateNo: { contains: term, mode: "insensitive" } },
        { externalCardNo: { contains: term, mode: "insensitive" } },
        { trainee: { fullName: { contains: term, mode: "insensitive" } } },
        { trainee: { idNumber: { contains: term, mode: "insensitive" } } },
        { trainee: { employerName: { contains: term, mode: "insensitive" } } },
        { trainee: { employerPartner: { name: { contains: term, mode: "insensitive" } } } },
      ];
    }
    const rows = await this.prisma.trainingCertificate.findMany({
      where,
      orderBy: filter.expiringWithinDays != null || filter.status === "EXPIRED" ? { expiryDate: "asc" } : { issueDate: "desc" },
      take: 1000,
      include: {
        course: { select: { id: true, code: true, name: true } },
        trainee: { select: { id: true, fullName: true, idNumber: true, phone: true, employerName: true, employerPartner: { select: { name: true } } } },
        enrollment: { select: { batch: { select: { id: true, batchNo: true } } } },
      },
    });
    return rows.map((c) => ({
      ...c,
      effectiveStatus: effectiveCertificateStatus(c),
      daysToExpiry: Math.round((c.expiryDate.getTime() - today.getTime()) / DAY_MS),
    }));
  }

  /** Everything the certificate PDF needs. */
  async getCertificate(companyId: string, id: string) {
    const c = await this.prisma.trainingCertificate.findFirst({
      where: { id, companyId },
      include: {
        course: true,
        trainee: { select: { id: true, fullName: true, fullNameAr: true, idType: true, idNumber: true, nationality: true, photoMimeType: true, employerName: true, employerPartner: { select: { name: true } } } },
        enrollment: { select: { theoryMarks: true, practicalMarks: true, batch: { select: { batchNo: true, startDate: true, endDate: true, venue: true, instructorName: true } } } },
      },
    });
    if (!c) throw new NotFoundException("Certificate not found");
    const [settings, company] = await Promise.all([
      this.getSettings(companyId),
      this.prisma.company.findUnique({ where: { id: companyId }, select: { legalName: true, tradeName: true } }),
    ]);
    return { ...c, effectiveStatus: effectiveCertificateStatus(c), settings, company };
  }

  async updateCertificate(companyId: string, id: string, userId: string, dto: UpdateCertificateDto) {
    const before = await this.getCertOwned(companyId, id);
    const updated = await this.prisma.trainingCertificate.update({ where: { id }, data: { externalCardNo: dto.externalCardNo?.trim() || null } });
    await this.audit.log({ companyId, entityName: "TrainingCertificate", entityId: id, action: "UPDATE", changedByUserId: userId, beforeSnapshot: before, afterSnapshot: updated });
    return updated;
  }

  async revokeCertificate(companyId: string, id: string, userId: string, dto: RevokeCertificateDto) {
    const before = await this.getCertOwned(companyId, id);
    if (before.status === TrainingCertificateStatus.REVOKED) throw new BadRequestException("Already revoked");
    const updated = await this.prisma.trainingCertificate.update({
      where: { id },
      data: { status: TrainingCertificateStatus.REVOKED, revokedReason: dto.reason, revokedAt: new Date() },
    });
    await this.audit.log({ companyId, entityName: "TrainingCertificate", entityId: id, action: "REVERSE", changedByUserId: userId, beforeSnapshot: before, afterSnapshot: updated });
    return updated;
  }

  private async getCertOwned(companyId: string, id: string) {
    const c = await this.prisma.trainingCertificate.findFirst({ where: { id, companyId } });
    if (!c) throw new NotFoundException("Certificate not found");
    return c;
  }

  // ── Public verification (no login) ────────────────────────────────────

  async verify(token: string) {
    const c = await this.prisma.trainingCertificate.findUnique({
      where: { verifyToken: token },
      include: {
        course: { select: { name: true, code: true } },
        trainee: { select: { fullName: true, fullNameAr: true, idType: true, idNumber: true, nationality: true, photoMimeType: true, employerName: true, employerPartner: { select: { name: true } } } },
        company: { select: { legalName: true, tradeName: true } },
      },
    });
    if (!c) throw new NotFoundException("Certificate not found");
    const id = c.trainee.idNumber;
    return {
      status: effectiveCertificateStatus(c),
      certificateNo: c.certificateNo,
      externalCardNo: c.externalCardNo,
      issueDate: toDateOnly(c.issueDate),
      expiryDate: toDateOnly(c.expiryDate),
      revokedReason: c.status === TrainingCertificateStatus.REVOKED ? c.revokedReason : null,
      course: c.course.name,
      courseCode: c.course.code,
      traineeName: c.trainee.fullName,
      traineeNameAr: c.trainee.fullNameAr,
      nationality: c.trainee.nationality,
      // Only the last 4 digits are shown publicly.
      idNumberMasked: id.length > 4 ? `${"•".repeat(id.length - 4)}${id.slice(-4)}` : id,
      idType: c.trainee.idType,
      employer: c.trainee.employerPartner?.name ?? c.trainee.employerName ?? null,
      issuer: c.company.tradeName || c.company.legalName,
      hasPhoto: !!c.trainee.photoMimeType,
    };
  }

  async verifyPhoto(token: string) {
    const c = await this.prisma.trainingCertificate.findUnique({ where: { verifyToken: token }, select: { trainee: { select: { photo: true, photoMimeType: true } } } });
    if (!c?.trainee.photo || !c.trainee.photoMimeType) throw new NotFoundException("No photo");
    return { data: Buffer.from(c.trainee.photo), mimeType: c.trainee.photoMimeType };
  }
}
