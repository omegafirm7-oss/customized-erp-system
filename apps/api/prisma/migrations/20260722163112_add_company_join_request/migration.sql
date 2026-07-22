-- CreateEnum
CREATE TYPE "CompanyJoinRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "company_join_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "CompanyJoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "roleId" TEXT,

    CONSTRAINT "company_join_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_join_requests_companyId_status_idx" ON "company_join_requests"("companyId", "status");

-- CreateIndex
CREATE INDEX "company_join_requests_userId_idx" ON "company_join_requests"("userId");

-- AddForeignKey
ALTER TABLE "company_join_requests" ADD CONSTRAINT "company_join_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_join_requests" ADD CONSTRAINT "company_join_requests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_join_requests" ADD CONSTRAINT "company_join_requests_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

