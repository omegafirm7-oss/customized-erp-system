-- Staff (director / project manager / supervisor) who pay company costs out of pocket and are repaid later.
ALTER TABLE "business_partners" ADD COLUMN "isStaffPayee" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "business_partners" ADD COLUMN "staffRole" TEXT;
ALTER TABLE "purchase_invoices" ADD COLUMN "reimbursementSupplierName" TEXT;
ALTER TABLE "purchase_invoices" ADD COLUMN "reimbursementSupplierVat" TEXT;
