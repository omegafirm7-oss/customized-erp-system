-- Receipt/evidence file attached to an EmployeePayment. Stored as bytes in
-- Postgres (no separate file-storage infra exists) so it's safe across
-- deploy-time git operations and backed up along with the rest of the data.
CREATE TABLE "employee_payment_attachments" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "employeePaymentId" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "data" BYTEA NOT NULL,
  "uploadedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "employee_payment_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "employee_payment_attachments_employeePaymentId_key"
  ON "employee_payment_attachments"("employeePaymentId");

ALTER TABLE "employee_payment_attachments"
  ADD CONSTRAINT "employee_payment_attachments_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employee_payment_attachments"
  ADD CONSTRAINT "employee_payment_attachments_employeePaymentId_fkey"
  FOREIGN KEY ("employeePaymentId") REFERENCES "employee_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
