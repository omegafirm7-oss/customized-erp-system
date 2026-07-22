import { INestApplication } from "@nestjs/common";
import { DocumentType } from "@prisma/client";
import { NumberingService } from "../src/numbering/numbering.service";
import { createTestApp, getPrisma, setupUserWithCompany } from "./utils/test-app";

describe("NumberingService concurrency (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("allocates a gapless, duplicate-free sequence under concurrent requests", async () => {
    const { companyId } = await setupUserWithCompany(app);
    const prisma = getPrisma(app);
    const numberingService = app.get(NumberingService);

    const concurrency = 10;
    const results = await Promise.all(
      Array.from({ length: concurrency }, () =>
        prisma.$transaction((tx) =>
          numberingService.allocate(tx, { companyId, documentType: DocumentType.JOURNAL_ENTRY, fiscalYearId: null }),
        ),
      ),
    );

    const unique = new Set(results);
    expect(unique.size).toBe(concurrency);

    const numbers = results.map((r) => Number(r.replace("JE-", ""))).sort((a, b) => a - b);
    for (let i = 1; i < numbers.length; i++) {
      expect(numbers[i]).toBe(numbers[i - 1] + 1);
    }
  });
});
