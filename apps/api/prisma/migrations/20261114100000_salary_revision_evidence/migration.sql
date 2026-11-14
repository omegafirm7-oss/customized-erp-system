-- AlterTable
ALTER TABLE "salary_revisions" ADD COLUMN "note" TEXT;

-- CreateTable
CREATE TABLE "salary_revision_attachments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "salaryRevisionId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salary_revision_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "salary_revision_attachments_salaryRevisionId_key" ON "salary_revision_attachments"("salaryRevisionId");

-- AddForeignKey
ALTER TABLE "salary_revision_attachments" ADD CONSTRAINT "salary_revision_attachments_salaryRevisionId_fkey" FOREIGN KEY ("salaryRevisionId") REFERENCES "salary_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
