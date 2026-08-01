-- AlterTable
ALTER TABLE "users" ADD COLUMN     "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;

-- Grant cross-tenant platform-owner visibility to the Omega Professionals account.
UPDATE "users" SET "isPlatformAdmin" = true WHERE "email" = 'omegafirm7@gmail.com';
