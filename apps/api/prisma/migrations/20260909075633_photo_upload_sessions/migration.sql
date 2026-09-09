CREATE TYPE "PhotoUploadSessionStatus" AS ENUM ('PENDING', 'UPLOADED');

CREATE TABLE "photo_upload_sessions" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "status" "PhotoUploadSessionStatus" NOT NULL DEFAULT 'PENDING',
    "filename" TEXT,
    "mimeType" TEXT,
    "size" INTEGER,
    "data" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "photo_upload_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "photo_upload_sessions_token_key" ON "photo_upload_sessions"("token");

ALTER TABLE "photo_upload_sessions" ADD CONSTRAINT "photo_upload_sessions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
