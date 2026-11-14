-- CreateTable
CREATE TABLE "salary_revisions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "basicSalary" DECIMAL(18,4) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salary_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "salary_revisions_companyId_idx" ON "salary_revisions"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "salary_revisions_employeeId_effectiveFrom_key" ON "salary_revisions"("employeeId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "salary_revisions" ADD CONSTRAINT "salary_revisions_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
