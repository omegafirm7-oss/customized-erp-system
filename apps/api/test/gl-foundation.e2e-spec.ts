import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, getPrisma, setupUserWithCompany } from "./utils/test-app";

/**
 * Covers the Phase 1 acceptance criteria from the plan: unbalanced-JE
 * rejection, posted-entry immutability, period-lock enforcement, reversal
 * correctness, and cross-company data isolation. Requires a real Postgres
 * database reachable via DATABASE_URL with migrations (including
 * prisma/sql/gl-constraints.sql) already applied — these are integration
 * tests against real DB constraints/triggers, not mocks.
 */
describe("GL foundation (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects a journal entry that does not balance", async () => {
    const { accessToken, cashAccount, equityAccount } = await setupUserWithCompany(app);

    const res = await request(app.getHttpServer())
      .post("/gl/journal-entries")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        postingDate: new Date().toISOString(),
        documentDate: new Date().toISOString(),
        lines: [
          { accountId: cashAccount.id, debit: "100.00", credit: "0" },
          { accountId: equityAccount.id, debit: "0", credit: "50.00" },
        ],
      });

    // Draft creation itself does not re-validate balance (only posting does),
    // so create succeeds; posting must reject it.
    expect(res.status).toBe(201);

    const postRes = await request(app.getHttpServer())
      .post(`/gl/journal-entries/${res.body.id}/post`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(postRes.status).toBe(400);
    expect(postRes.body.message).toMatch(/not balanced/i);
  });

  it("posts a balanced entry, allocates a sequential number, and makes it immutable", async () => {
    const { accessToken, companyId, cashAccount, equityAccount } = await setupUserWithCompany(app);

    const createRes = await request(app.getHttpServer())
      .post("/gl/journal-entries")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        postingDate: new Date().toISOString(),
        documentDate: new Date().toISOString(),
        memo: "Initial capital",
        lines: [
          { accountId: cashAccount.id, debit: "10000.00", credit: "0" },
          { accountId: equityAccount.id, debit: "0", credit: "10000.00" },
        ],
      })
      .expect(201);

    const postRes = await request(app.getHttpServer())
      .post(`/gl/journal-entries/${createRes.body.id}/post`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(201);

    expect(postRes.body.status).toBe("POSTED");
    expect(postRes.body.entryNumber).toBe("JE-000001");

    // Re-posting an already-posted entry must be rejected at the app layer.
    await request(app.getHttpServer())
      .post(`/gl/journal-entries/${createRes.body.id}/post`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(409);

    // Direct DB mutation of a posted entry must be rejected by the trigger
    // in prisma/sql/gl-constraints.sql, independent of the API.
    const prisma = getPrisma(app);
    await expect(
      prisma.journalEntry.update({ where: { id: createRes.body.id }, data: { memo: "tampered" } }),
    ).rejects.toThrow();

    void companyId;
  });

  it("reverses a posted entry with a linked, balancing reversal", async () => {
    const { accessToken, cashAccount, equityAccount } = await setupUserWithCompany(app);

    const createRes = await request(app.getHttpServer())
      .post("/gl/journal-entries")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        postingDate: new Date().toISOString(),
        documentDate: new Date().toISOString(),
        lines: [
          { accountId: cashAccount.id, debit: "500.00", credit: "0" },
          { accountId: equityAccount.id, debit: "0", credit: "500.00" },
        ],
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/gl/journal-entries/${createRes.body.id}/post`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(201);

    const reverseRes = await request(app.getHttpServer())
      .post(`/gl/journal-entries/${createRes.body.id}/reverse`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(201);

    expect(reverseRes.body.reversalOfEntryId).toBe(createRes.body.id);
    expect(reverseRes.body.status).toBe("POSTED");

    const originalRes = await request(app.getHttpServer())
      .get(`/gl/journal-entries/${createRes.body.id}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect(originalRes.body.status).toBe("REVERSED");

    const trialBalanceRes = await request(app.getHttpServer())
      .get("/reports/trial-balance")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect(trialBalanceRes.body.totalDebit).toBe(trialBalanceRes.body.totalCredit);
  });

  it("rejects posting into a closed fiscal period", async () => {
    const { accessToken, companyId, cashAccount, equityAccount } = await setupUserWithCompany(app);

    const periodsRes = await request(app.getHttpServer())
      .get("/companies/current/fiscal-periods")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    const now = new Date();
    const currentPeriod = periodsRes.body.find(
      (p: any) => new Date(p.startDate) <= now && new Date(p.endDate) >= now,
    );
    expect(currentPeriod).toBeDefined();

    const createRes = await request(app.getHttpServer())
      .post("/gl/journal-entries")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        postingDate: now.toISOString(),
        documentDate: now.toISOString(),
        lines: [
          { accountId: cashAccount.id, debit: "20.00", credit: "0" },
          { accountId: equityAccount.id, debit: "0", credit: "20.00" },
        ],
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/companies/current/fiscal-periods/${currentPeriod.id}/close`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(201);

    const postRes = await request(app.getHttpServer())
      .post(`/gl/journal-entries/${createRes.body.id}/post`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(postRes.status).toBe(409);
    expect(postRes.body.message).toMatch(/closed fiscal period/i);

    void companyId;
  });

  it("isolates data between companies", async () => {
    const companyA = await setupUserWithCompany(app);
    const companyB = await setupUserWithCompany(app);

    expect(companyA.companyId).not.toBe(companyB.companyId);
    expect(companyA.cashAccount.id).not.toBe(companyB.cashAccount.id);

    // Company B's token must not be able to see Company A's account.
    const crossRes = await request(app.getHttpServer())
      .get(`/coa/accounts/${companyA.cashAccount.id}`)
      .set("Authorization", `Bearer ${companyB.accessToken}`);

    expect(crossRes.status).toBe(404);
  });
});
