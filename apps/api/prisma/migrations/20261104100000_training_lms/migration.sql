-- CreateEnum
CREATE TYPE "TrainingBatchStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TrainingResult" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'ABSENT');

-- CreateEnum
CREATE TYPE "TrainingCertificateStatus" AS ENUM ('VALID', 'REVOKED');

-- CreateTable
CREATE TABLE "training_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "certificatePrefix" TEXT NOT NULL DEFAULT 'CERT',
    "nextCertificateNumber" INTEGER NOT NULL DEFAULT 1,
    "nextBatchNumber" INTEGER NOT NULL DEFAULT 1,
    "signatoryName" TEXT,
    "signatoryTitle" TEXT,
    "certificateFooterText" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_courses" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "durationDays" INTEGER NOT NULL DEFAULT 1,
    "durationHours" INTEGER,
    "pricePerTrainee" DECIMAL(18,2),
    "validityMonths" INTEGER NOT NULL DEFAULT 24,
    "passMarkPercent" INTEGER NOT NULL DEFAULT 70,
    "theoryMaxMarks" INTEGER NOT NULL DEFAULT 100,
    "practicalMaxMarks" INTEGER NOT NULL DEFAULT 100,
    "minAttendancePercent" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainees" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "fullNameAr" TEXT,
    "idType" TEXT NOT NULL DEFAULT 'IQAMA',
    "idNumber" TEXT NOT NULL,
    "nationality" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "dateOfBirth" DATE,
    "jobTitle" TEXT,
    "employerPartnerId" TEXT,
    "employerName" TEXT,
    "photo" BYTEA,
    "photoMimeType" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trainees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_batches" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "venue" TEXT,
    "instructorName" TEXT,
    "capacity" INTEGER,
    "status" "TrainingBatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_enrollments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "traineeId" TEXT NOT NULL,
    "theoryMarks" DECIMAL(7,2),
    "practicalMarks" DECIMAL(7,2),
    "result" "TrainingResult" NOT NULL DEFAULT 'PENDING',
    "resultOverride" BOOLEAN NOT NULL DEFAULT false,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_attendance" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "present" BOOLEAN NOT NULL,

    CONSTRAINT "training_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_certificates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "traineeId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "certificateNo" TEXT NOT NULL,
    "issueDate" DATE NOT NULL,
    "expiryDate" DATE NOT NULL,
    "externalCardNo" TEXT,
    "verifyToken" TEXT NOT NULL,
    "status" "TrainingCertificateStatus" NOT NULL DEFAULT 'VALID',
    "revokedReason" TEXT,
    "revokedAt" TIMESTAMP(3),
    "issuedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "training_settings_companyId_key" ON "training_settings"("companyId");

-- CreateIndex
CREATE INDEX "training_courses_companyId_idx" ON "training_courses"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "training_courses_companyId_code_key" ON "training_courses"("companyId", "code");

-- CreateIndex
CREATE INDEX "trainees_companyId_idx" ON "trainees"("companyId");

-- CreateIndex
CREATE INDEX "trainees_employerPartnerId_idx" ON "trainees"("employerPartnerId");

-- CreateIndex
CREATE UNIQUE INDEX "trainees_companyId_idNumber_key" ON "trainees"("companyId", "idNumber");

-- CreateIndex
CREATE INDEX "training_batches_companyId_idx" ON "training_batches"("companyId");

-- CreateIndex
CREATE INDEX "training_batches_courseId_idx" ON "training_batches"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "training_batches_companyId_batchNo_key" ON "training_batches"("companyId", "batchNo");

-- CreateIndex
CREATE INDEX "training_enrollments_companyId_idx" ON "training_enrollments"("companyId");

-- CreateIndex
CREATE INDEX "training_enrollments_traineeId_idx" ON "training_enrollments"("traineeId");

-- CreateIndex
CREATE UNIQUE INDEX "training_enrollments_batchId_traineeId_key" ON "training_enrollments"("batchId", "traineeId");

-- CreateIndex
CREATE UNIQUE INDEX "training_attendance_enrollmentId_date_key" ON "training_attendance"("enrollmentId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "training_certificates_enrollmentId_key" ON "training_certificates"("enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "training_certificates_verifyToken_key" ON "training_certificates"("verifyToken");

-- CreateIndex
CREATE INDEX "training_certificates_companyId_expiryDate_idx" ON "training_certificates"("companyId", "expiryDate");

-- CreateIndex
CREATE INDEX "training_certificates_traineeId_idx" ON "training_certificates"("traineeId");

-- CreateIndex
CREATE UNIQUE INDEX "training_certificates_companyId_certificateNo_key" ON "training_certificates"("companyId", "certificateNo");

-- AddForeignKey
ALTER TABLE "training_settings" ADD CONSTRAINT "training_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_courses" ADD CONSTRAINT "training_courses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainees" ADD CONSTRAINT "trainees_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainees" ADD CONSTRAINT "trainees_employerPartnerId_fkey" FOREIGN KEY ("employerPartnerId") REFERENCES "business_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_batches" ADD CONSTRAINT "training_batches_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_batches" ADD CONSTRAINT "training_batches_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "training_courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_enrollments" ADD CONSTRAINT "training_enrollments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_enrollments" ADD CONSTRAINT "training_enrollments_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "training_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_enrollments" ADD CONSTRAINT "training_enrollments_traineeId_fkey" FOREIGN KEY ("traineeId") REFERENCES "trainees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_attendance" ADD CONSTRAINT "training_attendance_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "training_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_certificates" ADD CONSTRAINT "training_certificates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_certificates" ADD CONSTRAINT "training_certificates_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "training_enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_certificates" ADD CONSTRAINT "training_certificates_traineeId_fkey" FOREIGN KEY ("traineeId") REFERENCES "trainees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_certificates" ADD CONSTRAINT "training_certificates_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "training_courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

