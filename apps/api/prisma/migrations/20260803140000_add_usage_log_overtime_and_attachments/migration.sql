-- Overtime hours recorded per usage-log day, mirroring
-- employee_timesheet_entries.overtimeHours: reporting only, never feeds
-- billing or the assignment's own hoursUsed-driven revenue.
ALTER TABLE "usage_log_entries"
  ADD COLUMN "overtimeHours" DECIMAL(7,2) NOT NULL DEFAULT 0;

-- One evidence file per usage-log day, same shape as
-- employee_timesheet_entry_attachments.
CREATE TABLE "usage_log_entry_attachments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "usageLogEntryId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_log_entry_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "usage_log_entry_attachments_usageLogEntryId_key" ON "usage_log_entry_attachments"("usageLogEntryId");

ALTER TABLE "usage_log_entry_attachments" ADD CONSTRAINT "usage_log_entry_attachments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "usage_log_entry_attachments" ADD CONSTRAINT "usage_log_entry_attachments_usageLogEntryId_fkey" FOREIGN KEY ("usageLogEntryId") REFERENCES "usage_log_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
