import { INestApplication } from "@nestjs/common";
import { createTestApp, getPrisma } from "./utils/test-app";
import { MailService } from "../src/common/mail/mail.service";
import { CLOUD_USAGE_PROVIDER, CloudUsageProvider } from "../src/platform/cloud-usage/cloud-usage.provider";
import { CloudUsageAlertService } from "../src/platform/cloud-usage/cloud-usage-alert.service";

describe("Oracle usage email alerts (e2e)", () => {
  let app: INestApplication;
  let alerts: CloudUsageAlertService;

  const sent: Array<{ to: string | string[]; subject: string; text: string }> = [];
  let mailConfigured = true;
  const usage = { ocpus: 1, storageGb: 47, cost: 0 };

  const fakeProvider: CloudUsageProvider = {
    getCost: async () => ({ monthToDateUsd: usage.cost, currency: "USD", byService: [] }),
    getCompute: async () => ({ ocpusUsed: usage.ocpus, memoryGbUsed: 6, instanceCount: 1 }),
    getBlockStorage: async () => ({ gbUsed: usage.storageGb, volumeCount: 1 }),
    getLoadBalancerCount: async () => 0,
  };
  const fakeMail = {
    isConfigured: () => mailConfigured,
    sendPlainEmail: async (message: { to: string | string[]; subject: string; text: string }) => {
      sent.push(message);
    },
  };

  beforeAll(async () => {
    process.env.OCI_ALERT_EMAIL = "owner@test.local, second@test.local";
    app = await createTestApp([
      { provide: CLOUD_USAGE_PROVIDER, useValue: fakeProvider },
      { provide: MailService, useValue: fakeMail },
    ]);
    alerts = app.get(CloudUsageAlertService);
  });

  afterAll(async () => {
    delete process.env.OCI_ALERT_EMAIL;
    await app.close();
  });

  beforeEach(async () => {
    sent.length = 0;
    mailConfigured = true;
    Object.assign(usage, { ocpus: 1, storageGb: 47, cost: 0 });
    await getPrisma(app).platformAlertState.deleteMany();
  });

  it("stays quiet while everything is comfortably under 80%", async () => {
    expect((await alerts.checkNow()).emailed).toEqual([]);
    expect(sent).toHaveLength(0);
  });

  it("emails once when a metric reaches 80%, to every configured address, and not again while it stays there", async () => {
    usage.ocpus = 3.4; // 85% of the 4 free OCPUs

    expect((await alerts.checkNow()).emailed).toEqual(["compute"]);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["owner@test.local", "second@test.local"]);
    expect(sent[0].subject).toContain("80%");
    expect(sent[0].text).toContain("Compute");
    expect(sent[0].text).toContain("85%");
    expect(sent[0].text).toContain("When billing starts");

    expect((await alerts.checkNow()).emailed).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  it("emails again if it then goes over the limit, stays quiet once back under, and re-arms for the next crossing", async () => {
    usage.ocpus = 3.4;
    await alerts.checkNow();
    expect(sent).toHaveLength(1);

    usage.ocpus = 5; // past the free limit
    await alerts.checkNow();
    expect(sent).toHaveLength(2);
    expect(sent[1].subject).toContain("exceeded");

    usage.ocpus = 1; // back to normal — nothing to send, but the alert re-arms
    await alerts.checkNow();
    expect(sent).toHaveLength(2);

    usage.ocpus = 3.5;
    await alerts.checkNow();
    expect(sent).toHaveLength(3);
  });

  it("emails immediately when a charge appears on the account", async () => {
    usage.cost = 2.5;
    expect((await alerts.checkNow()).emailed).toEqual(["cost"]);
    expect(sent[0].subject).toContain("charges have started");
    expect(sent[0].text).toContain("$2.50");
  });

  it("does not record the alert as sent while outgoing email isn't set up, so it goes out once it is", async () => {
    mailConfigured = false;
    usage.storageGb = 170; // 85% of the 200 GB free storage

    expect((await alerts.checkNow()).emailed).toEqual([]);
    expect(sent).toHaveLength(0);
    expect(await getPrisma(app).platformAlertState.count()).toBe(0);

    mailConfigured = true;
    expect((await alerts.checkNow()).emailed).toEqual(["blockStorage"]);
    expect(sent).toHaveLength(1);
  });

  it("tells the dashboard who gets the emails and whether email is set up", async () => {
    const info = await alerts.describe();
    expect(info).toMatchObject({ thresholdPercent: 80, emailConfigured: true, recipients: ["owner@test.local", "second@test.local"] });
  });
});
