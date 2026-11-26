-- CreateEnum
CREATE TYPE "DeliveryNoteStatus" AS ENUM ('DRAFT', 'DISPATCHED', 'DELIVERED', 'CANCELLED');

-- CreateTable
CREATE TABLE "delivery_notes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "deliveryNumber" TEXT,
    "salesOrderId" TEXT NOT NULL,
    "deliveryDate" TIMESTAMP(3) NOT NULL,
    "status" "DeliveryNoteStatus" NOT NULL DEFAULT 'DRAFT',
    "deliveryAddress" TEXT,
    "vehicleNumber" TEXT,
    "driverName" TEXT,
    "receivedByName" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "memo" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_note_lines" (
    "id" TEXT NOT NULL,
    "deliveryNoteId" TEXT NOT NULL,
    "salesOrderLineId" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "delivery_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "delivery_notes_companyId_deliveryNumber_key" ON "delivery_notes"("companyId", "deliveryNumber");

-- CreateIndex
CREATE INDEX "delivery_notes_companyId_status_idx" ON "delivery_notes"("companyId", "status");

-- CreateIndex
CREATE INDEX "delivery_notes_salesOrderId_idx" ON "delivery_notes"("salesOrderId");

-- CreateIndex
CREATE INDEX "delivery_note_lines_deliveryNoteId_idx" ON "delivery_note_lines"("deliveryNoteId");

-- CreateIndex
CREATE INDEX "delivery_note_lines_salesOrderLineId_idx" ON "delivery_note_lines"("salesOrderLineId");

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_note_lines" ADD CONSTRAINT "delivery_note_lines_deliveryNoteId_fkey" FOREIGN KEY ("deliveryNoteId") REFERENCES "delivery_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_note_lines" ADD CONSTRAINT "delivery_note_lines_salesOrderLineId_fkey" FOREIGN KEY ("salesOrderLineId") REFERENCES "sales_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Numbering series for every existing company (company provisioning only seeds series at creation time).
INSERT INTO "numbering_series" ("id", "companyId", "documentType", "prefix", "nextNumber", "numberLength", "fiscalYearId", "isActive")
SELECT gen_random_uuid(), c."id", 'DELIVERY_NOTE', 'DN-', 1, 6, NULL, true
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "numbering_series" ns
  WHERE ns."companyId" = c."id" AND ns."documentType" = 'DELIVERY_NOTE' AND ns."fiscalYearId" IS NULL
);
