import { INestApplication } from "@nestjs/common";
import request from "supertest";
import {
  createItem,
  createPartner,
  createTestApp,
  getPrisma,
  setupUserWithCompany,
  uniqueEmail,
} from "./utils/test-app";

// A read-only investor holds only projects.project.view. The project cost
// drill-downs show them expense lines and an Evidence "View" button, so the
// file behind it has to open — without handing them the whole Purchase
// Invoices module.
describe("Expense-line evidence access for project viewers (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

  async function loginAs(email: string, password: string): Promise<string> {
    const res = await request(app.getHttpServer()).post("/auth/login").send({ email, password }).expect(201);
    return res.body.accessToken;
  }

  /** A company member whose role carries exactly the given permission keys. */
  async function addMember(companyId: string, permissionKeys: string[]): Promise<string> {
    const prisma = getPrisma(app);
    const email = uniqueEmail("member");
    const password = "SuperSecret123!";
    await request(app.getHttpServer()).post("/auth/register").send({ email, password, fullName: "Limited Member" }).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const permissions = await prisma.permission.findMany({ where: { key: { in: permissionKeys } } });
    const role = await prisma.role.create({
      data: {
        companyId,
        name: `Limited-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        rolePermissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
      },
    });
    await prisma.companyUser.create({
      data: { userId: user.id, companyId, roleId: role.id, status: "ACTIVE", isDefault: true },
    });
    return loginAs(email, password);
  }

  it("lets a project-view-only user open evidence on project lines, but not on other expenses", async () => {
    const ctx = await setupUserWithCompany(app);
    const customer = await createPartner(app, ctx.accessToken, "CUSTOMER");
    const vendor = await createPartner(app, ctx.accessToken, "VENDOR");
    const item = await createItem(app, ctx.accessToken, {
      defaultSalesAccountId: ctx.accountByCode("4100").id,
      defaultPurchaseAccountId: ctx.accountByCode("5240").id,
    });

    const project = (
      await request(app.getHttpServer())
        .post("/projects")
        .set(auth(ctx.accessToken))
        .send({
          code: "EVID-1",
          name: "Evidence Project",
          businessPartnerId: customer.id,
          recognitionMethod: "OVER_TIME",
          contractValue: "10000",
          estimatedTotalCost: "5000",
        })
        .expect(201)
    ).body;

    await request(app.getHttpServer())
      .post(`/projects/${project.id}/status`)
      .set(auth(ctx.accessToken))
      .send({ status: "ACTIVE" })
      .expect(201);

    const today = new Date().toISOString().slice(0, 10);
    const invoiceIds: Record<string, string> = {};
    async function draftInvoice(lines: Array<{ projectId?: string }>) {
      return (
        await request(app.getHttpServer())
          .post("/ap/invoices")
          .set(auth(ctx.accessToken))
          .send({
            businessPartnerId: vendor.id,
            vendorInvoiceNumber: `EV-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            postingDate: today,
            dueDate: today,
            lines: lines.map((l) => ({ itemId: item.id, description: "Mixed line", quantity: "1", unitPrice: "50", ...l })),
          })
          .expect(201)
      ).body;
    }

    async function draftWithEvidence(projectId?: string) {
      const draft = (
        await request(app.getHttpServer())
          .post("/ap/invoices")
          .set(auth(ctx.accessToken))
          .send({
            businessPartnerId: vendor.id,
            vendorInvoiceNumber: `EV-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            postingDate: today,
            dueDate: today,
            lines: [{ itemId: item.id, description: "Evidence line", quantity: "1", unitPrice: "100", ...(projectId ? { projectId } : {}) }],
          })
          .expect(201)
      ).body;
      const lineId: string = draft.lines[0].id;
      invoiceIds[lineId] = draft.id;
      await request(app.getHttpServer())
        .post(`/ap/invoices/lines/${lineId}/attachment`)
        .set(auth(ctx.accessToken))
        .attach("file", PNG, { filename: "receipt.png", contentType: "image/png" })
        .expect(201);
      return lineId;
    }

    const projectLine = await draftWithEvidence(project.id);
    const plainLine = await draftWithEvidence();
    const projectInvoiceId = invoiceIds[projectLine];
    const plainInvoiceId = invoiceIds[plainLine];

    const investorToken = await addMember(ctx.companyId, ["projects.project.view"]);
    const nobodyToken = await addMember(ctx.companyId, []);

    // Investor: project-charged evidence opens, with the exact bytes.
    const file = await request(app.getHttpServer())
      .get(`/ap/invoices/lines/${projectLine}/attachment`)
      .set(auth(investorToken))
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((file.body as Buffer).equals(PNG)).toBe(true);

    // Investor: an expense that isn't charged to any project stays out of reach.
    await request(app.getHttpServer()).get(`/ap/invoices/lines/${plainLine}/attachment`).set(auth(investorToken)).expect(404);

    // No relevant permission at all: still refused outright.
    await request(app.getHttpServer()).get(`/ap/invoices/lines/${projectLine}/attachment`).set(auth(nobodyToken)).expect(403);

    // The company owner (AP_INVOICE_VIEW) keeps access to both.
    await request(app.getHttpServer()).get(`/ap/invoices/lines/${plainLine}/attachment`).set(auth(ctx.accessToken)).expect(200);

    // The Purchase Invoices list: the investor gets only fully project-charged
    // invoices — not the plain one, not one that mixes project + other lines.
    const mixed = await draftInvoice([{ projectId: project.id }, {}]);
    const visibleToInvestor = (await request(app.getHttpServer()).get("/ap/invoices").set(auth(investorToken)).expect(200)).body;
    const visibleIds = visibleToInvestor.map((i: any) => i.id);
    expect(visibleIds).toContain(projectInvoiceId);
    expect(visibleIds).not.toContain(plainInvoiceId);
    expect(visibleIds).not.toContain(mixed.id);
    for (const inv of visibleToInvestor) {
      expect(inv.lines.every((l: any) => l.projectId)).toBe(true);
    }
    // ...while the owner still sees everything, and a member with no relevant
    // permission is refused.
    const ownerIds = (await request(app.getHttpServer()).get("/ap/invoices").set(auth(ctx.accessToken)).expect(200)).body.map((i: any) => i.id);
    expect(ownerIds).toEqual(expect.arrayContaining([projectInvoiceId, plainInvoiceId, mixed.id]));
    await request(app.getHttpServer()).get("/ap/invoices").set(auth(nobodyToken)).expect(403);

    // View only: the investor cannot create, post, edit or delete anything.
    await request(app.getHttpServer()).post("/ap/invoices").set(auth(investorToken)).send({}).expect(403);
    await request(app.getHttpServer()).post(`/ap/invoices/${projectInvoiceId}/post`).set(auth(investorToken)).expect(403);
    await request(app.getHttpServer()).delete(`/ap/invoices/${projectInvoiceId}`).set(auth(investorToken)).expect(403);
  });
});
