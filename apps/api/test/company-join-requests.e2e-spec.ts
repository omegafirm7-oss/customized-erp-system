import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, setupUserWithCompany, uniqueEmail } from "./utils/test-app";

describe("Company join requests (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  async function registerAndLogin() {
    const email = uniqueEmail("joiner");
    const password = "SuperSecret123!";
    await request(app.getHttpServer()).post("/auth/register").send({ email, password, fullName: "Joiner" }).expect(201);
    const loginRes = await request(app.getHttpServer()).post("/auth/login").send({ email, password }).expect(201);
    return { email, password, accessToken: loginRes.body.accessToken as string };
  }

  async function getCompanyCode(accessToken: string) {
    const res = await request(app.getHttpServer()).get("/companies/current").set(auth(accessToken)).expect(200);
    return res.body.code as string;
  }

  it("runs the full request → approve lifecycle, granting company membership with the chosen role", async () => {
    const admin = await setupUserWithCompany(app);
    const companyCode = await getCompanyCode(admin.accessToken);
    const joiner = await registerAndLogin();

    const created = await request(app.getHttpServer())
      .post("/companies/join-requests")
      .set(auth(joiner.accessToken))
      .send({ companyCode, message: "Please let me in" })
      .expect(201);
    expect(created.body.status).toBe("PENDING");

    const mine = await request(app.getHttpServer())
      .get("/companies/join-requests/mine")
      .set(auth(joiner.accessToken))
      .expect(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].status).toBe("PENDING");

    const pending = await request(app.getHttpServer())
      .get("/iam/join-requests")
      .set(auth(admin.accessToken))
      .expect(200);
    const pendingRow = pending.body.find((r: any) => r.id === created.body.id);
    expect(pendingRow).toBeDefined();
    expect(pendingRow.email).toBe(joiner.email);

    const roles = await request(app.getHttpServer()).get("/iam/roles").set(auth(admin.accessToken)).expect(200);
    const viewerRole = roles.body.find((r: any) => r.name === "Viewer");
    expect(viewerRole).toBeDefined();

    const approved = await request(app.getHttpServer())
      .post(`/iam/join-requests/${created.body.id}/approve`)
      .set(auth(admin.accessToken))
      .send({ roleId: viewerRole.id })
      .expect(201);
    expect(approved.body.status).toBe("APPROVED");

    // Re-login to pick up the new membership, then confirm it's usable.
    const rescopedLogin = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: joiner.email, password: joiner.password })
      .expect(201);
    const myCompanies = await request(app.getHttpServer())
      .get("/iam/me/companies")
      .set(auth(rescopedLogin.body.accessToken))
      .expect(200);
    const membership = myCompanies.body.find((c: any) => c.companyCode === companyCode);
    expect(membership).toBeDefined();
    expect(membership.roleName).toBe("Viewer");
    expect(membership.isDefault).toBe(true); // first membership for this user

    await request(app.getHttpServer())
      .post("/auth/switch-company")
      .set(auth(rescopedLogin.body.accessToken))
      .send({ companyId: admin.companyId })
      .expect(201);
  });

  it("rejects a request, and allows the same user to request again afterwards", async () => {
    const admin = await setupUserWithCompany(app);
    const companyCode = await getCompanyCode(admin.accessToken);
    const joiner = await registerAndLogin();

    const created = await request(app.getHttpServer())
      .post("/companies/join-requests")
      .set(auth(joiner.accessToken))
      .send({ companyCode })
      .expect(201);

    const rejected = await request(app.getHttpServer())
      .post(`/iam/join-requests/${created.body.id}/reject`)
      .set(auth(admin.accessToken))
      .send({})
      .expect(201);
    expect(rejected.body.status).toBe("REJECTED");

    const mine = await request(app.getHttpServer())
      .get("/companies/join-requests/mine")
      .set(auth(joiner.accessToken))
      .expect(200);
    expect(mine.body[0].status).toBe("REJECTED");

    // A rejected request doesn't block requesting again.
    const secondAttempt = await request(app.getHttpServer())
      .post("/companies/join-requests")
      .set(auth(joiner.accessToken))
      .send({ companyCode })
      .expect(201);
    expect(secondAttempt.body.status).toBe("PENDING");
  });

  it("blocks a duplicate pending request for the same company", async () => {
    const admin = await setupUserWithCompany(app);
    const companyCode = await getCompanyCode(admin.accessToken);
    const joiner = await registerAndLogin();

    await request(app.getHttpServer())
      .post("/companies/join-requests")
      .set(auth(joiner.accessToken))
      .send({ companyCode })
      .expect(201);

    await request(app.getHttpServer())
      .post("/companies/join-requests")
      .set(auth(joiner.accessToken))
      .send({ companyCode })
      .expect(409);
  });

  it("404s when requesting a company code that does not exist", async () => {
    const joiner = await registerAndLogin();

    await request(app.getHttpServer())
      .post("/companies/join-requests")
      .set(auth(joiner.accessToken))
      .send({ companyCode: "NO-SUCH-CODE" })
      .expect(404);
  });

  it("blocks an already-active member from requesting to join their own company again", async () => {
    const admin = await setupUserWithCompany(app);
    const companyCode = await getCompanyCode(admin.accessToken);

    await request(app.getHttpServer())
      .post("/companies/join-requests")
      .set(auth(admin.accessToken))
      .send({ companyCode })
      .expect(409);
  });

  it("blocks approving/rejecting a join request from a different company's admin", async () => {
    const owningAdmin = await setupUserWithCompany(app);
    const otherAdmin = await setupUserWithCompany(app);
    const companyCode = await getCompanyCode(owningAdmin.accessToken);
    const joiner = await registerAndLogin();

    const created = await request(app.getHttpServer())
      .post("/companies/join-requests")
      .set(auth(joiner.accessToken))
      .send({ companyCode })
      .expect(201);

    const roles = await request(app.getHttpServer()).get("/iam/roles").set(auth(otherAdmin.accessToken)).expect(200);
    const viewerRole = roles.body.find((r: any) => r.name === "Viewer");

    await request(app.getHttpServer())
      .post(`/iam/join-requests/${created.body.id}/approve`)
      .set(auth(otherAdmin.accessToken))
      .send({ roleId: viewerRole.id })
      .expect(404);

    await request(app.getHttpServer())
      .post(`/iam/join-requests/${created.body.id}/reject`)
      .set(auth(otherAdmin.accessToken))
      .send({})
      .expect(404);
  });
});
