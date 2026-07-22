-- CreateEnum
CREATE TYPE "ZatcaEnvironment" AS ENUM ('SANDBOX', 'SIMULATION', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "ZatcaDeviceStatus" AS ENUM ('CREATED', 'COMPLIANCE_CSID_ISSUED', 'COMPLIANCE_CHECKED', 'ACTIVE', 'FAILED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ZatcaInvoiceKind" AS ENUM ('STANDARD', 'SIMPLIFIED');

-- CreateEnum
CREATE TYPE "ZatcaSubmissionType" AS ENUM ('CLEARANCE', 'REPORTING');

-- CreateEnum
CREATE TYPE "ZatcaSubmissionStatus" AS ENUM ('PENDING', 'CLEARED', 'REPORTED', 'REJECTED', 'FAILED');

-- AlterTable
ALTER TABLE "business_partners" ADD COLUMN     "additionalIdNumber" TEXT,
ADD COLUMN     "additionalIdScheme" TEXT;

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "additionalNumber" TEXT,
ADD COLUMN     "buildingNumber" TEXT,
ADD COLUMN     "district" TEXT;

-- AlterTable
ALTER TABLE "partner_addresses" ADD COLUMN     "buildingNumber" TEXT,
ADD COLUMN     "district" TEXT;

-- AlterTable
ALTER TABLE "sales_invoice_lines" ADD COLUMN     "vatExemptionReasonCode" TEXT,
ADD COLUMN     "vatExemptionReasonText" TEXT;

-- AlterTable
ALTER TABLE "sales_invoices" ADD COLUMN     "creditNoteReason" TEXT,
ADD COLUMN     "deliveryDate" TIMESTAMP(3),
ADD COLUMN     "paymentMeansCode" TEXT;

-- CreateTable
CREATE TABLE "zatca_devices" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "environment" "ZatcaEnvironment" NOT NULL,
    "unitName" TEXT NOT NULL,
    "egsSerialNumber" TEXT NOT NULL,
    "privateKeyEnc" TEXT NOT NULL,
    "csrPem" TEXT NOT NULL,
    "complianceRequestId" TEXT,
    "complianceCsid" TEXT,
    "complianceSecretEnc" TEXT,
    "productionCsid" TEXT,
    "productionSecretEnc" TEXT,
    "certificateExpiresAt" TIMESTAMP(3),
    "status" "ZatcaDeviceStatus" NOT NULL DEFAULT 'CREATED',
    "failureReason" TEXT,
    "icvCounter" INTEGER NOT NULL DEFAULT 0,
    "lastInvoiceHash" TEXT NOT NULL DEFAULT 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==',
    "onboardedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zatca_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zatca_submissions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "salesInvoiceId" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "icv" INTEGER NOT NULL,
    "invoiceHash" TEXT NOT NULL,
    "previousInvoiceHash" TEXT NOT NULL,
    "invoiceKind" "ZatcaInvoiceKind" NOT NULL,
    "submissionType" "ZatcaSubmissionType" NOT NULL,
    "signedXml" TEXT NOT NULL,
    "clearedXml" TEXT,
    "qrCode" TEXT,
    "status" "ZatcaSubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "zatcaResponse" JSONB,
    "warnings" JSONB,
    "errors" JSONB,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zatca_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "zatca_devices_companyId_environment_key" ON "zatca_devices"("companyId", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "zatca_submissions_salesInvoiceId_key" ON "zatca_submissions"("salesInvoiceId");

-- CreateIndex
CREATE INDEX "zatca_submissions_companyId_status_idx" ON "zatca_submissions"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "zatca_submissions_deviceId_icv_key" ON "zatca_submissions"("deviceId", "icv");

-- AddForeignKey
ALTER TABLE "zatca_devices" ADD CONSTRAINT "zatca_devices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zatca_submissions" ADD CONSTRAINT "zatca_submissions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "zatca_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zatca_submissions" ADD CONSTRAINT "zatca_submissions_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
