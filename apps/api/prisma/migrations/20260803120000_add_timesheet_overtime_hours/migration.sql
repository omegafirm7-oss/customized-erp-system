-- Overtime hours recorded per timesheet day. Reporting only: nothing in
-- payroll or the accrued labor cost reads this column, so backfilling
-- existing rows with 0 cannot move any posted figure.
ALTER TABLE "employee_timesheet_entries"
  ADD COLUMN "overtimeHours" DECIMAL(5,2) NOT NULL DEFAULT 0;
