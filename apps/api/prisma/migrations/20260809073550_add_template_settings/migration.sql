-- CreateTable
CREATE TABLE "template_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "logo" BYTEA,
    "logoMimeType" TEXT,
    "accentColor" TEXT NOT NULL DEFAULT '#101828',
    "footerText" TEXT,
    "showAddressInHeader" BOOLEAN NOT NULL DEFAULT true,
    "showTaxNumberInHeader" BOOLEAN NOT NULL DEFAULT true,
    "timesheetTitle" TEXT NOT NULL DEFAULT 'Monthly Timesheet',
    "timesheetShowIqama" BOOLEAN NOT NULL DEFAULT true,
    "timesheetShowDesignation" BOOLEAN NOT NULL DEFAULT true,
    "salesShowItemCode" BOOLEAN NOT NULL DEFAULT true,
    "salesShowVatBreakdown" BOOLEAN NOT NULL DEFAULT true,
    "salesTermsText" TEXT,
    "purchaseShowItemCode" BOOLEAN NOT NULL DEFAULT true,
    "purchaseShowVatBreakdown" BOOLEAN NOT NULL DEFAULT true,
    "purchaseTermsText" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "template_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "template_settings_companyId_key" ON "template_settings"("companyId");

-- AddForeignKey
ALTER TABLE "template_settings" ADD CONSTRAINT "template_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

