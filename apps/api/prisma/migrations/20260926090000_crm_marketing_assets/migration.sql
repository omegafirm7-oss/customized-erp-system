-- AlterTable
ALTER TABLE "crm_activities" ADD COLUMN     "attachmentNames" TEXT[] DEFAULT ARRAY[]::TEXT[];


-- CreateTable
CREATE TABLE "crm_marketing_assets" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_marketing_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_marketing_assets_companyId_idx" ON "crm_marketing_assets"("companyId");

-- AddForeignKey
ALTER TABLE "crm_marketing_assets" ADD CONSTRAINT "crm_marketing_assets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

