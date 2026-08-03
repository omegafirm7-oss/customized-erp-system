-- Replace the per-day/per-employee timesheet attachment with one
-- attachment per fiscal period (confirmed 0 rows in production before this
-- migration — safe to drop outright rather than migrate data).
DROP TABLE "employee_timesheet_entry_attachments";

CREATE TABLE "timesheet_period_attachments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fiscalPeriodId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timesheet_period_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "timesheet_period_attachments_fiscalPeriodId_key" ON "timesheet_period_attachments"("fiscalPeriodId");

ALTER TABLE "timesheet_period_attachments" ADD CONSTRAINT "timesheet_period_attachments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "timesheet_period_attachments" ADD CONSTRAINT "timesheet_period_attachments_fiscalPeriodId_fkey" FOREIGN KEY ("fiscalPeriodId") REFERENCES "fiscal_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Internal-use day-rate costing for equipment used on our own projects
-- (Hiace vans, buses, etc.) — distinct from EquipmentAssignment.billRate,
-- which charges a rental-contract customer.
ALTER TABLE "equipment" ADD COLUMN "internalDayRate" DECIMAL(18,4);

CREATE TABLE "project_equipment_assignments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "dayRate" DECIMAL(18,4) NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_equipment_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "project_equipment_assignments_projectId_idx" ON "project_equipment_assignments"("projectId");
CREATE INDEX "project_equipment_assignments_equipmentId_isActive_idx" ON "project_equipment_assignments"("equipmentId", "isActive");

ALTER TABLE "project_equipment_assignments" ADD CONSTRAINT "project_equipment_assignments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_equipment_assignments" ADD CONSTRAINT "project_equipment_assignments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_equipment_assignments" ADD CONSTRAINT "project_equipment_assignments_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "project_equipment_log_entries" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT true,
    "hoursUsed" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "overtimeHours" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "enteredByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_equipment_log_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_equipment_log_entries_assignmentId_date_key" ON "project_equipment_log_entries"("assignmentId", "date");
CREATE INDEX "project_equipment_log_entries_companyId_date_idx" ON "project_equipment_log_entries"("companyId", "date");

ALTER TABLE "project_equipment_log_entries" ADD CONSTRAINT "project_equipment_log_entries_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "project_equipment_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "project_equipment_period_attachments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fiscalPeriodId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_equipment_period_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_equipment_period_attachments_projectId_fiscalPeriod_key" ON "project_equipment_period_attachments"("projectId", "fiscalPeriodId");

ALTER TABLE "project_equipment_period_attachments" ADD CONSTRAINT "project_equipment_period_attachments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_equipment_period_attachments" ADD CONSTRAINT "project_equipment_period_attachments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_equipment_period_attachments" ADD CONSTRAINT "project_equipment_period_attachments_fiscalPeriodId_fkey" FOREIGN KEY ("fiscalPeriodId") REFERENCES "fiscal_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
