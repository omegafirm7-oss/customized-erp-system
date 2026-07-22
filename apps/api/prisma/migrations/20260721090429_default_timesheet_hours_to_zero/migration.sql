-- Default hours-worked to 0, not 10 — hours are always entered explicitly
-- per day, never assumed. The application layer already always passes an
-- explicit hoursWorked value on create, so this only affects the column's
-- symbolic fallback default, not existing rows.
ALTER TABLE "employee_timesheet_entries" ALTER COLUMN "hoursWorked" SET DEFAULT 0;
