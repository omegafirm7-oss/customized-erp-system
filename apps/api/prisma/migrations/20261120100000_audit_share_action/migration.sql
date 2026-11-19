-- A file (such as a timesheet PDF) was sent to someone, for example through WhatsApp.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SHARE';
