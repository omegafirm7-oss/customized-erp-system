-- Adds FOOD as a distinct straight-expense EmployeePayment category
-- (tracked separately from ALLOWANCE for reporting, but both default to the
-- ALLOWANCE_EXPENSE control account) and a reversedAt timestamp so a
-- wrongly-recorded payment can be corrected via a reversing JE instead of a
-- hard delete, while being excluded from all paid/pending aggregations.
ALTER TYPE "EmployeePaymentCategory" ADD VALUE 'FOOD';

ALTER TABLE "employee_payments" ADD COLUMN "reversedAt" TIMESTAMP(3);
