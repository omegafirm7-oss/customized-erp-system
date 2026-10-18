import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppConfig } from "../../core/config/configuration";
import { PrismaService } from "../../common/prisma/prisma.service";
import { MailService } from "../../common/mail/mail.service";
import { CloudUsageService, CloudUsageSnapshot } from "./cloud-usage.service";
import { CLOUD_USAGE_PROVIDER, CloudUsageProvider } from "./cloud-usage.provider";
import { ALERT_THRESHOLD_PERCENT, alertTransition, UsageStatus } from "./cloud-usage.util";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 2 * 60 * 1000;

interface MonitoredMetric {
  key: string;
  label: string;
  status: UsageStatus;
  line: string;
}

export interface CloudUsageAlertInfo {
  thresholdPercent: number;
  emailConfigured: boolean;
  recipients: string[];
  lastAlertAt: string | null;
}

/**
 * Emails the platform owner when Oracle Cloud usage reaches 80% of an Always
 * Free limit (and again if it goes over, or if a charge appears), checking
 * every 6 hours in the background. Each metric is emailed once per crossing:
 * the last level emailed is remembered in `platform_alert_states`, and it
 * re-arms once usage drops back under the threshold. If outgoing email isn't
 * configured the alert is NOT recorded as sent, so it goes out on a later
 * check once SMTP settings exist.
 */
@Injectable()
export class CloudUsageAlertService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CloudUsageAlertService.name);
  private timers: NodeJS.Timeout[] = [];
  private warnedNoMail = false;

  constructor(
    private readonly usage: CloudUsageService,
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService<AppConfig, true>,
    @Optional() @Inject(CLOUD_USAGE_PROVIDER) private readonly provider: CloudUsageProvider | null,
  ) {}

  onModuleInit() {
    // Nothing to watch until OCI is connected; and no background timers under jest.
    if (!this.provider || process.env.NODE_ENV === "test") return;
    const run = () => this.checkNow().catch((err) => this.logger.error(`Usage alert check failed: ${(err as Error).message}`));
    const first = setTimeout(run, FIRST_CHECK_DELAY_MS);
    const repeat = setInterval(run, CHECK_INTERVAL_MS);
    first.unref();
    repeat.unref();
    this.timers.push(first, repeat);
  }

  onModuleDestroy() {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
  }

  /** What the dashboard shows about the alert setup. */
  async describe(): Promise<CloudUsageAlertInfo> {
    const last = await this.prisma.platformAlertState.findFirst({ orderBy: { alertedAt: "desc" } });
    return {
      thresholdPercent: ALERT_THRESHOLD_PERCENT,
      emailConfigured: this.mail.isConfigured(),
      recipients: await this.recipients(),
      lastAlertAt: last ? last.alertedAt.toISOString() : null,
    };
  }

  /** One alert pass: fetch fresh numbers, email anything newly past the threshold. */
  async checkNow(): Promise<{ emailed: string[] }> {
    const snap = await this.usage.getSnapshot(true);
    if (!snap.configured || snap.error) return { emailed: [] };

    const metrics = this.metricsOf(snap);
    const saved = new Map((await this.prisma.platformAlertState.findMany()).map((s) => [s.key, s]));

    const toAlert: MonitoredMetric[] = [];
    for (const metric of metrics) {
      const decision = alertTransition((saved.get(metric.key)?.level as UsageStatus | undefined) ?? null, metric.status);
      if (decision === "alert") toAlert.push(metric);
      if (decision === "clear") {
        await this.prisma.platformAlertState.update({ where: { key: metric.key }, data: { level: "ok" } });
      }
    }
    if (toAlert.length === 0) return { emailed: [] };

    const recipients = await this.recipients();
    if (!this.mail.isConfigured() || recipients.length === 0) {
      if (!this.warnedNoMail) {
        this.logger.warn(
          `Oracle usage alert pending for ${toAlert.map((m) => m.label).join(", ")} but there is nowhere to send it (SMTP settings or recipients missing) — will retry on the next check`,
        );
        this.warnedNoMail = true;
      }
      return { emailed: [] };
    }

    await this.mail.sendPlainEmail({
      to: recipients,
      subject: this.subjectFor(toAlert),
      text: this.bodyFor(snap, metrics, toAlert),
    });
    this.warnedNoMail = false;
    for (const metric of toAlert) {
      await this.prisma.platformAlertState.upsert({
        where: { key: metric.key },
        create: { key: metric.key, level: metric.status },
        update: { level: metric.status, alertedAt: new Date() },
      });
    }
    this.logger.log(`Oracle usage alert emailed to ${recipients.join(", ")} for ${toAlert.map((m) => m.label).join(", ")}`);
    return { emailed: toAlert.map((m) => m.key) };
  }

  private metricsOf(snap: CloudUsageSnapshot): MonitoredMetric[] {
    const pct = (n: number) => `${Math.round(n)}%`;
    const worstComputePercent = Math.max(snap.compute.ocpusPercent, snap.compute.memoryPercent);
    return [
      {
        key: "compute",
        label: "Compute (CPU / memory)",
        status: snap.compute.status,
        line: `Compute: ${snap.compute.ocpusUsed} of ${snap.compute.ocpusCap} OCPUs (${pct(snap.compute.ocpusPercent)}), ${snap.compute.memoryGbUsed} of ${snap.compute.memoryGbCap} GB memory (${pct(snap.compute.memoryPercent)}) — highest ${pct(worstComputePercent)}`,
      },
      {
        key: "blockStorage",
        label: "Block storage",
        status: snap.blockStorage.status,
        line: `Block storage: ${snap.blockStorage.gbUsed} of ${snap.blockStorage.gbCap} GB (${pct(snap.blockStorage.percent)})`,
      },
      {
        key: "loadBalancers",
        label: "Load balancers",
        status: snap.loadBalancers.status,
        line: `Load balancers: ${snap.loadBalancers.count} of ${snap.loadBalancers.cap} (${pct(snap.loadBalancers.percent)})`,
      },
      {
        key: "cost",
        label: "Charges",
        // Any charge at all means billing has started, so it is "over" straight away.
        status: (snap.cost?.monthToDateUsd ?? 0) > 0 ? "over" : "ok",
        line: `Cost this month so far: $${(snap.cost?.monthToDateUsd ?? 0).toFixed(2)}`,
      },
    ];
  }

  private subjectFor(alerts: MonitoredMetric[]): string {
    if (alerts.some((a) => a.key === "cost")) return "Universa Centrix: Oracle Cloud charges have started";
    if (alerts.some((a) => a.status === "over")) return "Universa Centrix: Oracle Cloud free limit exceeded";
    return `Universa Centrix: Oracle Cloud usage reached ${ALERT_THRESHOLD_PERCENT}% of the free limit`;
  }

  private bodyFor(snap: CloudUsageSnapshot, all: MonitoredMetric[], alerts: MonitoredMetric[]): string {
    const appUrl = this.config.get("mail", { infer: true }).appUrl;
    const flagged = new Set(alerts.map((a) => a.key));
    return [
      "Universa Centrix — Oracle Cloud usage alert",
      "",
      "What needs attention:",
      ...alerts.map((a) => `  • ${a.line}${a.status === "over" ? "  [OVER THE FREE LIMIT]" : ""}`),
      "",
      `Everything, as of ${snap.checkedAt}:`,
      ...all.map((a) => `  ${flagged.has(a.key) ? "!" : "-"} ${a.line}`),
      "",
      "When billing starts: Oracle only charges for usage ABOVE the Always Free limits (4 OCPUs, 24 GB memory, 200 GB block storage, 1 load balancer) or for paid services added to the account. Staying under every limit means no charge; going over one starts charges from that point.",
      "",
      `Live numbers: ${appUrl}/platform (Platform > Client Dashboard > Cloud infrastructure).`,
      "",
      `You get this email once each time a limit is reached (${ALERT_THRESHOLD_PERCENT}% of the free limit, or when it is exceeded); it re-arms once usage drops back under ${ALERT_THRESHOLD_PERCENT}%.`,
    ].join("\n");
  }

  private async recipients(): Promise<string[]> {
    const configured = this.config
      .get("oci", { infer: true })
      .alertEmail.split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    if (configured.length > 0) return configured;
    const admins = await this.prisma.user.findMany({ where: { isPlatformAdmin: true, isActive: true }, select: { email: true } });
    return admins.map((a) => a.email);
  }
}
