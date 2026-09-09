-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "familyId" TEXT NOT NULL DEFAULT gen_random_uuid();

-- CreateIndex
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");
