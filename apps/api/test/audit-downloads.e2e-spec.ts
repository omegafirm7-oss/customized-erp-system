import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { asPlatformAdmin, createTestApp, setupUserWithCompany } from "./utils/test-app";

// A timesheet PDF is built in the browser, so the browser reports each download to the server. The platform admin
// can then see in the Activity Log who took which timesheet, and when.
describe("Activity Log records timesheet downloads (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const HEADER =
    "code,nameEn,nameAr,designation,nationality,isSaudi,iqamaOrNationalId,iqamaExpiry,passportNumber,passportExpiry,gosiNumber,joinDate,contractType,bankCode,iban,costCenterCode,annualLeaveDays,basicSalary,housingAllowance,transportAllowance,otherAllowance,gosiExempt";

  async function setup() {
    const ctx = await setupUserWithCompany(app);
    const csv = [HEADER, "EMPT,Tariq Hasan,,Mason,PK,false,2298765432,2027-12-31,,,,2026-01-01,LIMITED,10,SA0380000000608010167519,,21,3000,0,0,0,false"].join("\n");
    await request(app.getHttpServer()).post("/hr/employees/import").set(auth(ctx.accessToken)).send({ csv }).expect(201);
    const employees = (await request(app.getHttpServer()).get("/hr/employees").set(auth(ctx.accessToken)).expect(200)).body;
    const periods = (await request(app.getHttpServer()).get("/companies/current/fiscal-periods").set(auth(ctx.accessToken)).expect(200)).body;
    return { ctx, employee: employees.find((e: any) => e.code === "EMPT"), period: periods[0] };
  }

  it("logs who downloaded or WhatsApp-shared a timesheet, from the database's own facts", async () => {
    const { ctx, employee, period } = await setup();
    const server = app.getHttpServer();

    await request(server).post("/audit/events/timesheet-download").set(auth(ctx.accessToken)).send({ employeeId: employee.id, periodId: period.id, channel: "DOWNLOAD" }).expect(201);
    await request(server).post("/audit/events/timesheet-download").set(auth(ctx.accessToken)).send({ employeeId: employee.id, periodId: period.id, channel: "WHATSAPP" }).expect(201);

    const adminToken = await asPlatformAdmin(app, ctx);
    // Downloads and WhatsApp sends are separate activity types, each with its own filter.
    const downloads = (await request(server).get("/audit/activity-log").query({ action: "DOWNLOAD", entityName: "Timesheet PDF" }).set(auth(adminToken)).expect(200)).body;
    expect(downloads.total).toBe(1);
    expect(downloads.items[0].user.email).toBe(ctx.email);
    expect(downloads.items[0].details).toMatchObject({ employeeCode: "EMPT", employeeName: "Tariq Hasan", via: "Downloaded" });
    expect(downloads.items[0].details.period).toContain("to");

    const shares = (await request(server).get("/audit/activity-log").query({ action: "SHARE", entityName: "Timesheet PDF" }).set(auth(adminToken)).expect(200)).body;
    expect(shares.total).toBe(1);
    expect(shares.items[0].action).toBe("SHARE");
    expect(shares.items[0].details).toMatchObject({ employeeCode: "EMPT", via: "Sent via WhatsApp", sentTo: null }); // this employee has no phone saved

    // Both together under the record type.
    const both = (await request(server).get("/audit/activity-log").query({ entityName: "Timesheet PDF" }).set(auth(adminToken)).expect(200)).body;
    expect(both.total).toBe(2);

    // The drop-down for record types offers it.
    const types = (await request(server).get("/audit/activity-log/record-types").set(auth(adminToken)).expect(200)).body;
    expect(types.map((t: any) => t.entityName)).toContain("Timesheet PDF");
  });

  it("only accepts real employees of the caller's own company, and the log stays platform-admin only", async () => {
    const a = await setup();
    const b = await setup();
    const server = app.getHttpServer();
    // Another company's employee id is refused, so entries can't be forged across companies.
    await request(server).post("/audit/events/timesheet-download").set(auth(a.ctx.accessToken)).send({ employeeId: b.employee.id, channel: "DOWNLOAD" }).expect(404);
    await request(server).post("/audit/events/timesheet-download").set(auth(a.ctx.accessToken)).send({ employeeId: a.employee.id, channel: "EMAIL" }).expect(400);
    // An ordinary company user can report a download but cannot read the log.
    await request(server).get("/audit/activity-log").set(auth(a.ctx.accessToken)).expect(403);
  });
});
