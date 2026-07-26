-- Adds a dedicated "Project Salaries & Wages" control account, distinct
-- from the general 5200 Salaries & Wages account, so payroll can post
-- gross salary for employees on a project's cost center separately from
-- office/admin salaries. Payroll routing logic (payroll.service.ts,
-- termination.service.ts) picks this account automatically when the
-- employee's cost center belongs to a Project.

ALTER TYPE "ControlAccountType" ADD VALUE 'PROJECT_SALARY_EXPENSE';
