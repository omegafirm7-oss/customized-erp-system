-- A file (such as an employee's timesheet PDF) was downloaded or shared.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DOWNLOAD';
