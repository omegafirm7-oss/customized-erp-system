-- Adds SALARY as a direct-cash-payment category on EmployeePayment, letting
-- a user pay down the timesheet-accrued "pending salary" figure without
-- running formal payroll — mirrors ALLOWANCE (straight expense, no
-- recovery) but posts to SALARY_EXPENSE/PROJECT_SALARY_EXPENSE instead of
-- ALLOWANCE_EXPENSE, and is netted against pendingLaborAccrual.
ALTER TYPE "EmployeePaymentCategory" ADD VALUE 'SALARY';
