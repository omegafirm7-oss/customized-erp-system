-- Constraints for the release-payment tracking and day-cost attendance
-- models. No new control accounts needed — SettlementPayment reuses the
-- existing SALARIES_PAYABLE (2310) resolution and bank/cash accounts.

ALTER TABLE "settlement_payments"
  ADD CONSTRAINT "settlement_payments_amount_check"
  CHECK ("amount" > 0);

ALTER TABLE "final_settlements"
  ADD CONSTRAINT "final_settlements_paid_amount_check"
  CHECK ("paidAmount" >= 0 AND "paidAmount" <= "netAmount");

ALTER TABLE "employee_attendance"
  ADD CONSTRAINT "employee_attendance_days_worked_check"
  CHECK ("daysWorked" >= 0 AND "daysWorked" <= 31);
