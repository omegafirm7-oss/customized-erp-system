-- CreateTable
CREATE TABLE "purchase_invoice_line_attachments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "purchaseInvoiceLineId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_invoice_line_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_timesheet_entry_attachments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeTimesheetEntryId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_timesheet_entry_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoice_line_attachments_purchaseInvoiceLineId_key" ON "purchase_invoice_line_attachments"("purchaseInvoiceLineId");

-- CreateIndex
CREATE UNIQUE INDEX "employee_timesheet_entry_attachments_employeeTimesheetEntry_key" ON "employee_timesheet_entry_attachments"("employeeTimesheetEntryId");

-- AddForeignKey
ALTER TABLE "purchase_invoice_line_attachments" ADD CONSTRAINT "purchase_invoice_line_attachments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_line_attachments" ADD CONSTRAINT "purchase_invoice_line_attachments_purchaseInvoiceLineId_fkey" FOREIGN KEY ("purchaseInvoiceLineId") REFERENCES "purchase_invoice_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_timesheet_entry_attachments" ADD CONSTRAINT "employee_timesheet_entry_attachments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_timesheet_entry_attachments" ADD CONSTRAINT "employee_timesheet_entry_attachments_employeeTimesheetEntr_fkey" FOREIGN KEY ("employeeTimesheetEntryId") REFERENCES "employee_timesheet_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
