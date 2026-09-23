-- CreateEnum
CREATE TYPE "LeadPriority" AS ENUM ('HOT', 'WARM', 'COLD');

-- AlterEnum
ALTER TYPE "CrmActivityType" ADD VALUE 'WHATSAPP';

-- AlterEnum
ALTER TYPE "LeadSource" ADD VALUE 'AI_RESEARCH';

-- AlterTable
ALTER TABLE "crm_activities" ADD COLUMN     "autoSend" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "messageBody" TEXT,
ADD COLUMN     "messageSubject" TEXT,
ADD COLUMN     "recipient" TEXT,
ADD COLUMN     "sendError" TEXT,
ADD COLUMN     "sentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "aiConfidence" TEXT,
ADD COLUMN     "aiRationale" TEXT,
ADD COLUMN     "businessLines" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "city" TEXT,
ADD COLUMN     "companyWebsite" TEXT,
ADD COLUMN     "contractorGrade" TEXT,
ADD COLUMN     "estimatedValue" DECIMAL(18,4),
ADD COLUMN     "followUpDate" TIMESTAMP(3),
ADD COLUMN     "priority" "LeadPriority" NOT NULL DEFAULT 'WARM',
ADD COLUMN     "projectName" TEXT,
ADD COLUMN     "safetyCertsRequired" TEXT[] DEFAULT ARRAY[]::TEXT[];


-- CreateTable
CREATE TABLE "crm_agent_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "companyProfile" TEXT NOT NULL,
    "emailSignature" TEXT,
    "replyToEmail" TEXT,
    "whatsappNumber" TEXT,
    "defaultLanguage" TEXT NOT NULL DEFAULT 'en',
    "followUpDays" TEXT NOT NULL DEFAULT '3,7',
    "autoSendEmailFollowUps" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_agent_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_agent_settings_companyId_key" ON "crm_agent_settings"("companyId");

-- CreateIndex
CREATE INDEX "crm_activities_autoSend_sentAt_dueDate_idx" ON "crm_activities"("autoSend", "sentAt", "dueDate");

-- AddForeignKey
ALTER TABLE "crm_agent_settings" ADD CONSTRAINT "crm_agent_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

