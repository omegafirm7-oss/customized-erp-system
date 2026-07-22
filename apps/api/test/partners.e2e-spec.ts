import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, setupUserWithCompany } from "./utils/test-app";

describe("Business Partners CSV import (e2e)", () => {
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

  const CSV_HEADER = "code,name,nameAr,partnerType,taxRegistrationNumber,commercialRegistrationNumber,currencyCode";

  it("downloads a template matching the expected column order", async () => {
    const { accessToken } = await setupUserWithCompany(app);
    const res = await request(app.getHttpServer())
      .get("/partners/import/template")
      .set(auth(accessToken))
      .expect(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.text.split(/\r?\n/)[0]).toBe(CSV_HEADER);
  });

  it("imports valid vendor and customer rows with VAT/CR numbers", async () => {
    const { accessToken } = await setupUserWithCompany(app);
    const csv = [
      CSV_HEADER,
      "V-001,Al Falak Trading Est.,,VENDOR,300012345600003,1010123456,SAR",
      "C-001,Red Dune Contracting Co.,,CUSTOMER,300098765400003,1010987654,SAR",
    ].join("\n");

    const res = await request(app.getHttpServer())
      .post("/partners/import")
      .set(auth(accessToken))
      .send({ csv })
      .expect(201);
    expect(res.body.imported).toBe(2);
    expect(res.body.errors).toHaveLength(0);

    const list = (
      await request(app.getHttpServer()).get("/partners").set(auth(accessToken)).expect(200)
    ).body;
    const vendor = list.find((p: any) => p.code === "V-001");
    expect(vendor.partnerType).toBe("VENDOR");
    expect(vendor.taxRegistrationNumber).toBe("300012345600003");
    const customer = list.find((p: any) => p.code === "C-001");
    expect(customer.partnerType).toBe("CUSTOMER");
  });

  it("rejects the whole file (all-or-nothing) on a bad partnerType or duplicate code", async () => {
    const { accessToken } = await setupUserWithCompany(app);

    const badType = [CSV_HEADER, "V-002,Bad Type Vendor,,SUPPLIER,,,SAR"].join("\n");
    const badTypeRes = await request(app.getHttpServer())
      .post("/partners/import")
      .set(auth(accessToken))
      .send({ csv: badType })
      .expect(201);
    expect(badTypeRes.body.imported).toBe(0);
    expect(badTypeRes.body.errors.length).toBeGreaterThan(0);

    const dup = [CSV_HEADER, "V-003,Dup A,,VENDOR,,,SAR", "V-003,Dup B,,VENDOR,,,SAR"].join("\n");
    const dupRes = await request(app.getHttpServer())
      .post("/partners/import")
      .set(auth(accessToken))
      .send({ csv: dup })
      .expect(201);
    expect(dupRes.body.imported).toBe(0);
    expect(dupRes.body.errors[0].message).toMatch(/Duplicate code/);

    // Neither partial file should have created anything
    const list = (
      await request(app.getHttpServer()).get("/partners").set(auth(accessToken)).expect(200)
    ).body;
    expect(list).toHaveLength(0);
  });

  it("rejects import of a code that already exists in the company", async () => {
    const { accessToken } = await setupUserWithCompany(app);
    await request(app.getHttpServer())
      .post("/partners")
      .set(auth(accessToken))
      .send({ code: "V-004", name: "Existing Vendor", partnerType: "VENDOR" })
      .expect(201);

    const csv = [CSV_HEADER, "V-004,Reimported Vendor,,VENDOR,,,SAR"].join("\n");
    await request(app.getHttpServer())
      .post("/partners/import")
      .set(auth(accessToken))
      .send({ csv })
      .expect(400);
  });

  it("isolates partner data between companies", async () => {
    const a = await setupUserWithCompany(app);
    const csv = [CSV_HEADER, "V-005,Company A Vendor,,VENDOR,,,SAR"].join("\n");
    await request(app.getHttpServer()).post("/partners/import").set(auth(a.accessToken)).send({ csv }).expect(201);

    const b = await setupUserWithCompany(app);
    const bList = (
      await request(app.getHttpServer()).get("/partners").set(auth(b.accessToken)).expect(200)
    ).body;
    expect(bList).toHaveLength(0);
  });
});
