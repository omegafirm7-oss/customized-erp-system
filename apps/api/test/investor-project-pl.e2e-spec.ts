import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createItem, createPartner, createTestApp, getPrisma, setupUserWithCompany, uniqueEmail } from "./utils/test-app";

// A read-only investor holds only projects.project.view. They may open the Statement of Profit or Loss and drill
// into it for a project, but never the company-wide statement or any other report.
describe("Project-only profit and loss for project viewers (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const range = "fromDate=2020-01-01T00:00:00.000Z&toDate=2099-12-31T00:00:00.000Z";

  async function addMember(companyId: string, permissionKeys: string[]): Promise<string> {
    const prisma = getPrisma(app);
    const email = uniqueEmail("investor");
    const password = "SuperSecret123!";
    await request(app.getHttpServer()).post("/auth/register").send({ email, password, fullName: "Investor" }).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const permissions = await prisma.permission.findMany({ where: { key: { in: permissionKeys } } });
    const role = await prisma.role.create({
      data: { companyId, name: `Investor-${Date.now()}`, rolePermissions: { create: permissions.map((p) => ({ permissionId: p.id })) } },
    });
    await prisma.companyUser.create({ data: { userId: user.id, companyId, roleId: role.id, status: "ACTIVE", isDefault: true } });
    return (await request(app.getHttpServer()).post("/auth/login").send({ email, password }).expect(201)).body.accessToken;
  }

  it("shows a project viewer that project's statement and its drill-downs, and nothing company-wide", async () => {
    const ctx = await setupUserWithCompany(app);
    const customer = await createPartner(app, ctx.accessToken, "CUSTOMER");
    const vendor = await createPartner(app, ctx.accessToken, "VENDOR");
    const item = await createItem(app, ctx.accessToken, { defaultPurchaseAccountId: ctx.accountByCode("5240").id });

    const project = (
      await request(app.getHttpServer())
        .post("/projects")
        .set(auth(ctx.accessToken))
        .send({ code: "INV-1", name: "Investor Project", businessPartnerId: customer.id, recognitionMethod: "OVER_TIME", contractValue: "100000", estimatedTotalCost: "60000" })
        .expect(201)
    ).body;
    await request(app.getHttpServer()).post(`/projects/${project.id}/status`).set(auth(ctx.accessToken)).send({ status: "ACTIVE" }).expect(201);

    const today = new Date().toISOString();
    const post = async (net: string, ref: string, projectId?: string, withReceipt = false) => {
      const draft = (
        await request(app.getHttpServer())
          .post("/ap/invoices")
          .set(auth(ctx.accessToken))
          .send({ businessPartnerId: vendor.id, vendorInvoiceNumber: ref, postingDate: today, dueDate: today, lines: [{ itemId: item.id, description: "Cost", quantity: "1", unitPrice: net, projectId }] })
          .expect(201)
      ).body;
      if (withReceipt) {
        await request(app.getHttpServer())
          .post(`/ap/invoices/lines/${draft.lines[0].id}/attachment`)
          .set(auth(ctx.accessToken))
          .attach("file", Buffer.from("%PDF-1.4 receipt"), { filename: "receipt.pdf", contentType: "application/pdf" })
          .expect(201);
      }
      await request(app.getHttpServer()).post(`/ap/invoices/${draft.id}/post`).set(auth(ctx.accessToken)).expect(201);
    };
    await post("1000", "PROJ-1", project.id, true);
    await post("300", "OTHER-1");

    const investor = await addMember(ctx.companyId, ["projects.project.view"]);
    const get = (url: string) => request(app.getHttpServer()).get(url).set(auth(investor));
    const expenseAccountId = ctx.accountByCode("5240").id;

    // the project statement and its drill-downs open, and contain only that project's figures
    const pl = (await get(`/reports/profit-or-loss?${range}&projectId=${project.id}`).expect(200)).body;
    expect(Number(pl.operatingExpense)).toBe(1000);
    const detail = (await get(`/reports/profit-or-loss/line-detail?line=operatingExpense&${range}&projectId=${project.id}`).expect(200)).body;
    expect(Number(detail.total)).toBe(1000);
    const txns = (await get(`/reports/accounts/${expenseAccountId}/transactions?${range}&projectId=${project.id}`).expect(200)).body;
    expect(txns.transactions).toHaveLength(1);
    expect(txns.transactions[0].supplierInvoice).toBe("PROJ-1");
    expect(txns.transactions[0].evidence).toHaveLength(1);
    await get(`/ap/invoices/lines/${txns.transactions[0].evidence[0].lineId}/attachment`).expect(200);

    // but nothing company-wide: no project means no statement, and other reports stay closed
    await get(`/reports/profit-or-loss?${range}`).expect(403);
    await get(`/reports/profit-or-loss/line-detail?line=operatingExpense&${range}`).expect(403);
    await get(`/reports/accounts/${expenseAccountId}/transactions?${range}`).expect(403);
    await get(`/reports/financial-position?asOfDate=2099-12-31`).expect(403);
    await get(`/reports/trial-balance`).expect(403);

    // a user with no project permission at all gets nothing, even with a project id
    const nobody = await addMember(ctx.companyId, []);
    await request(app.getHttpServer()).get(`/reports/profit-or-loss?${range}&projectId=${project.id}`).set(auth(nobody)).expect(403);
  });
});
