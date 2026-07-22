import { Injectable, NotFoundException } from "@nestjs/common";
import { DocumentType, Prisma } from "@prisma/client";

type TxClient = Prisma.TransactionClient;

interface AllocateParams {
  companyId: string;
  documentType: DocumentType;
  fiscalYearId?: string | null;
}

interface SeriesRow {
  id: string;
  prefix: string | null;
  nextNumber: number;
  numberLength: number;
}

/**
 * Gapless, duplicate-free document numbering. Must be called with the same
 * `tx` (Prisma.TransactionClient) that creates the document, so the row lock
 * taken here is held for the lifetime of that single transaction — two
 * concurrent callers for the same (companyId, documentType, fiscalYearId)
 * serialize on the `FOR UPDATE` lock instead of racing on nextNumber.
 *
 * This exact primitive is reused, unmodified, for ZATCA sales-invoice
 * numbering in a later phase — gapless sequential numbering is a hard
 * ZATCA Phase 2 compliance requirement, not just a nicety here.
 */
@Injectable()
export class NumberingService {
  async allocate(tx: TxClient, params: AllocateParams): Promise<string> {
    const rows = await tx.$queryRaw<SeriesRow[]>`
      SELECT "id", "prefix", "nextNumber", "numberLength"
      FROM "numbering_series"
      WHERE "companyId" = ${params.companyId}
        AND "documentType" = ${params.documentType}::"DocumentType"
        AND "fiscalYearId" IS NOT DISTINCT FROM ${params.fiscalYearId ?? null}
      FOR UPDATE
    `;

    const series = rows[0];
    if (!series) {
      throw new NotFoundException(
        `No numbering series configured for ${params.documentType} in company ${params.companyId}`,
      );
    }

    const formatted = `${series.prefix ?? ""}${String(series.nextNumber).padStart(series.numberLength, "0")}`;

    await tx.$executeRaw`
      UPDATE "numbering_series"
      SET "nextNumber" = "nextNumber" + 1
      WHERE "id" = ${series.id}
    `;

    return formatted;
  }
}
