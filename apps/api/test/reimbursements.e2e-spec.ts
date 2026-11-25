import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, setupUserWithCompany } from "./utils/test-app";

// A project manager pays for site costs out of pocket. The cost must reach the project (VAT included) the moment it is
// recorded, the company must owe him the money until it repays him, and repaying must never change the project cost.
describe("Staff reimbursements (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function setup() {
    const ctx = await setupUserWithCompany(app);
    const server = app.getHttpServer();
    const project = (await request(server).post("/projects").set(auth(ctx.accessToken)).send({ code: "KHF", name: "Khafji" }).expect(201)).body;
    await request(server).post(`/projects/${project.id}/status`).set(auth(ctx.accessToken)).send({ status: "ACTIVE" }).expect(201);
    const payee = (await request(server).post("/reimbursements/payees").set(auth(ctx.accessToken)).send({ name: "Ahmed", role: "Project Manager" }).expect(201)).body;
    return { ctx, project, payee, server };
  }

  const expense = (over: Record<string, unknown>) => ({
    date: new Date().toISOString(),
    supplierName: "Al Noor Hardware",
    supplierVat: "300123456700003",
    receiptNumber: `R-${Math.random().toString(36).slice(2, 7)}`,
    description: "Site consumables",
    amount: "115",
    hasVatInvoice: true,
    post: true,
    ...over,
  });

  it("books the cost on the project with VAT, owes the person, and repaying leaves the project cost unchanged", async () => {
    const { ctx, project, payee, server } = await setup();
    const accountId = ctx.accountByCode("5104").id;

    // 115 paid, with a VAT invoice: 100 cost + 15 VAT. A second 50 paid with no VAT invoice: all 50 is cost.
    await request(server).post(`/reimbursements/payees/${payee.id}/expenses`).set(auth(ctx.accessToken)).send(expense({ projectId: project.id, accountId })).expect(201);
    await request(server)
      .post(`/reimbursements/payees/${payee.id}/expenses`)
      .set(auth(ctx.accessToken))
      .send(expense({ projectId: project.id, accountId, amount: "50", hasVatInvoice: false, supplierVat: undefined }))
      .expect(201);

    const dash = (await request(server).get(`/projects/${project.id}/intelligence`).set(auth(ctx.accessToken)).expect(200)).body;
    expect(dash.grandTotal).toBe("165.00"); // 115 + 50, VAT included
    expect(dash.owedToStaff).toBe("165.00");

    const reg = (await request(server).get(`/projects/${project.id}/expenses`).set(auth(ctx.accessToken)).expect(200)).body;
    expect(reg.total).toBe("165.00");
    expect(reg.rows.every((r: any) => r.source === "Paid by Ahmed (Project Manager) — to reimburse")).toBe(true);
    expect(reg.rows.map((r: any) => r.partnerName)).toEqual(["Al Noor Hardware", "Al Noor Hardware"]);

    const before = (await request(server).get(`/reimbursements/payees/${payee.id}/statement`).set(auth(ctx.accessToken)).expect(200)).body;
    expect(before.spent).toBe("165.00");
    expect(before.owed).toBe("165.00");
    expect(before.rows).toHaveLength(2);

    // Repay 100 of the 165 from the bank.
    await request(server)
      .post(`/reimbursements/payees/${payee.id}/reimburse`)
      .set(auth(ctx.accessToken))
      .send({ paymentDate: new Date().toISOString(), bankCashAccountId: ctx.accountByCode("1120").id, amount: "100" })
      .expect(201);

    const after = (await request(server).get(`/reimbursements/payees/${payee.id}/statement`).set(auth(ctx.accessToken)).expect(200)).body;
    expect(after.repaid).toBe("100.00");
    expect(after.owed).toBe("65.00");

    const list = (await request(server).get("/reimbursements/payees").set(auth(ctx.accessToken)).expect(200)).body;
    expect(list[0]).toMatchObject({ name: "Ahmed", spent: "165.00", repaid: "100.00", owed: "65.00" });

    const dash2 = (await request(server).get(`/projects/${project.id}/intelligence`).set(auth(ctx.accessToken)).expect(200)).body;
    expect(dash2.grandTotal).toBe("165.00"); // repaying is not a second cost
    expect(dash2.owedToStaff).toBe("65.00");

    // Cannot repay more than is owed.
    await request(server)
      .post(`/reimbursements/payees/${payee.id}/reimburse`)
      .set(auth(ctx.accessToken))
      .send({ paymentDate: new Date().toISOString(), bankCashAccountId: ctx.accountByCode("1120").id, amount: "66" })
      .expect(400);
  });

  it("insists on the supplier's VAT number before any VAT is claimed", async () => {
    const { ctx, project, payee, server } = await setup();
    await request(server)
      .post(`/reimbursements/payees/${payee.id}/expenses`)
      .set(auth(ctx.accessToken))
      .send(expense({ projectId: project.id, accountId: ctx.accountByCode("5104").id, supplierVat: "" }))
      .expect(400);
  });
});
