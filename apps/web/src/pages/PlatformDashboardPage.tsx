import { useEffect, useState } from "react";
import { apiClient } from "../api/client";

// Mirrors MODULE_KEYS in packages/shared-constants (kept as a plain literal
// here, not imported — @erp/shared-constants ships CJS output and this repo
// has no prior runtime import of it from the web app to build on; every
// other cross-boundary type here, e.g. DecodedAccessToken vs JwtPayload, is
// likewise hand-mirrored rather than imported).
const MODULE_LABELS = {
  purchase: "Purchase",
  crm: "CRM",
  sales: "Sales & Marketing",
  // Pakistan clients only — the FBR menu appears for PK companies.
  fbr: "FBR (Pakistan)",
} as const;
const ALL_MODULES = Object.keys(MODULE_LABELS) as (keyof typeof MODULE_LABELS)[];

interface PlatformSummary {
  totalClients: number;
  activeClients: number;
  totalUsers: number;
  activeUsers: number;
  totalStorageBytes: number;
  storageLimitBytes: number;
  storageUsedPercent: number;
}

type UsageStatus = "ok" | "warning" | "over";

interface CloudUsageSnapshot {
  configured: boolean;
  checkedAt: string | null;
  cost: { monthToDateUsd: number; currency: string; byService: { service: string; amountUsd: number }[] } | null;
  compute: {
    ocpusUsed: number;
    ocpusCap: number;
    ocpusPercent: number;
    memoryGbUsed: number;
    memoryGbCap: number;
    memoryPercent: number;
    status: UsageStatus;
  };
  blockStorage: { gbUsed: number; gbCap: number; percent: number; volumeCount: number; status: UsageStatus };
  loadBalancers: { count: number; cap: number; percent: number; status: UsageStatus };
  billing: "none" | "approaching" | "active";
  alerts?: { thresholdPercent: number; emailConfigured: boolean; recipients: string[]; lastAlertAt: string | null };
  error?: string;
}

const BILLING_TONES = {
  green: { bg: "#ecfdf3", border: "#abefc6", text: "#067647" },
  amber: { bg: "#fffaeb", border: "#fedf89", text: "#b54708" },
  red: { bg: "#fef3f2", border: "#fecdca", text: "#b42318" },
} as const;

/** The plain-language answer to "am I being billed, and when would I be?" */
function billingBanner(c: CloudUsageSnapshot): { tone: keyof typeof BILLING_TONES; title: string; text: string } {
  if (c.billing === "active") {
    const charged = c.cost && c.cost.monthToDateUsd > 0 ? `Oracle has charged ${c.cost.monthToDateUsd.toFixed(2)} this month so far. ` : "";
    return {
      tone: "red",
      title: "Billing has started",
      text: charged + "A resource is over its Always Free limit, so Oracle bills the excess. Bring usage back under the limits below to stop new charges.",
    };
  }
  if (c.billing === "approaching") {
    return {
      tone: "amber",
      title: "Not billing yet, but getting close",
      text: "Billing starts the moment any resource goes over its Always Free limit. The bars below show how much room is left.",
    };
  }
  return {
    tone: "green",
    title: "No billing: everything is inside the free limits",
    text: "Oracle only starts billing when a resource goes over its Always Free limit (4 OCPUs, 24 GB memory, 200 GB block storage, 1 load balancer) or a paid service is added to the account.",
  };
}

function roomLeft(used: number, cap: number, unit: string): string {
  const left = cap - used;
  if (left <= 0) return "Over the free limit, so the excess is billed";
  return `${Number(left.toFixed(1)).toLocaleString()}${unit ? " " + unit : ""} left before billing starts`;
}

interface PlatformClient {
  id: string;
  code: string;
  legalName: string;
  tradeName: string | null;
  isActive: boolean;
  createdAt: string;
  userCount: number;
  activeUserCount: number;
  storageBytes: number;
  enabledModules: string[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const STATUS_COLOR: Record<UsageStatus, string> = { ok: "#12b76a", warning: "#f79009", over: "#d92d20" };

export function PlatformDashboardPage() {
  const [summary, setSummary] = useState<PlatformSummary | null>(null);
  const [clients, setClients] = useState<PlatformClient[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [cloudUsage, setCloudUsage] = useState<CloudUsageSnapshot | null>(null);
  const [cloudUsageError, setCloudUsageError] = useState<string | null>(null);
  const [refreshingCloudUsage, setRefreshingCloudUsage] = useState(false);

  useEffect(() => {
    Promise.all([
      apiClient.get<PlatformSummary>("/platform/summary"),
      apiClient.get<PlatformClient[]>("/platform/clients"),
    ])
      .then(([summaryRes, clientsRes]) => {
        setSummary(summaryRes.data);
        setClients(clientsRes.data);
      })
      .catch((err) => setError(err?.response?.data?.message ?? "Failed to load platform dashboard"));
  }, []);

  // Fetched independently of summary/clients (own loading/error state) so a
  // slow or failing OCI call never blocks the rest of the dashboard.
  function loadCloudUsage(force: boolean) {
    if (force) setRefreshingCloudUsage(true);
    apiClient
      .get<CloudUsageSnapshot>("/platform/cloud-usage", { params: force ? { force: "true" } : undefined })
      .then((res) => {
        setCloudUsage(res.data);
        setCloudUsageError(null);
      })
      .catch((err) => setCloudUsageError(err?.response?.data?.message ?? "Failed to load cloud infrastructure usage"))
      .finally(() => setRefreshingCloudUsage(false));
  }

  useEffect(() => {
    loadCloudUsage(false);
  }, []);

  async function toggleModule(client: PlatformClient, moduleKey: string) {
    const nextModules = client.enabledModules.includes(moduleKey)
      ? client.enabledModules.filter((m) => m !== moduleKey)
      : [...client.enabledModules, moduleKey];
    setSavingId(client.id);
    try {
      await apiClient.patch(`/platform/clients/${client.id}/modules`, { enabledModules: nextModules });
      setClients((prev) => prev?.map((c) => (c.id === client.id ? { ...c, enabledModules: nextModules } : c)) ?? prev);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to update client modules");
    } finally {
      setSavingId(null);
    }
  }

  if (error) return <div className="error-banner">{error}</div>;
  if (!summary || !clients) return <p style={{ padding: 24 }}>Loading…</p>;

  return (
    <div>
      <div className="card">
        <h2>Platform overview</h2>
        <div className="kpi-grid">
          <div className="kpi-tile" style={{ cursor: "default" }}>
            <span className="kpi-label">Total clients</span>
            <span className="kpi-value">{summary.totalClients}</span>
          </div>
          <div className="kpi-tile" style={{ cursor: "default" }}>
            <span className="kpi-label">Active clients</span>
            <span className="kpi-value">{summary.activeClients}</span>
          </div>
          <div className="kpi-tile" style={{ cursor: "default" }}>
            <span className="kpi-label">Total users</span>
            <span className="kpi-value">
              {summary.activeUsers} / {summary.totalUsers} active
            </span>
          </div>
        </div>
        <p style={{ color: "#667085", marginTop: 16, marginBottom: -4 }}>
          {formatBytes(summary.totalStorageBytes)} of app attachments (receipts, invoices, evidence) — compared
          against a {formatBytes(summary.storageLimitBytes)} reference cap ({summary.storageUsedPercent}%). For the
          actual OCI block-volume usage, see Cloud infrastructure below.
        </p>
        <div style={{ background: "#eaecf0", borderRadius: 6, height: 10, overflow: "hidden" }}>
          <div
            style={{
              width: `${Math.min(100, summary.storageUsedPercent)}%`,
              background:
                summary.storageUsedPercent > 80 ? "#d92d20" : summary.storageUsedPercent > 50 ? "#f79009" : "#12b76a",
              height: "100%",
            }}
          />
        </div>
      </div>

      <div className="card">
        <h2>Cloud infrastructure (Oracle)</h2>
        {cloudUsageError && <p style={{ color: "#d92d20" }}>{cloudUsageError}</p>}
        {!cloudUsageError && !cloudUsage && <p style={{ color: "#98a2b3" }}>Loading…</p>}
        {!cloudUsageError && cloudUsage && !cloudUsage.configured && (
          <p style={{ color: "#667085" }}>
            Not connected yet — set the OCI_* environment variables to enable live cost and Always-Free-usage
            monitoring here.
          </p>
        )}
        {!cloudUsageError && cloudUsage?.configured && (
          <>
            {cloudUsage.error && (
              <p style={{ color: "#d92d20", marginBottom: 12 }}>{cloudUsage.error}</p>
            )}
            {!cloudUsage.error &&
              (() => {
                const banner = billingBanner(cloudUsage);
                const tone = BILLING_TONES[banner.tone];
                return (
                  <div
                    style={{ background: tone.bg, border: `1px solid ${tone.border}`, color: tone.text, borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13.5 }}
                  >
                    <strong>{banner.title}</strong>
                    <div style={{ marginTop: 2 }}>{banner.text}</div>
                  </div>
                );
              })()}
            {cloudUsage.cost && (
              <div style={{ marginBottom: 8 }}>
                <span className="kpi-label">Cost this month (as of last OCI data refresh)</span>
                <div className="kpi-value">
                  ${cloudUsage.cost.monthToDateUsd.toFixed(2)} {cloudUsage.cost.currency}
                </div>
                {cloudUsage.cost.byService.length > 0 && (
                  <p style={{ color: "#667085", fontSize: 13, marginTop: 4 }}>
                    {cloudUsage.cost.byService
                      .slice(0, 4)
                      .map((s) => `${s.service}: $${s.amountUsd.toFixed(2)}`)
                      .join(" · ")}
                  </p>
                )}
              </div>
            )}

            {[
              {
                label: "Compute: CPUs",
                used: cloudUsage.compute.ocpusUsed,
                cap: cloudUsage.compute.ocpusCap,
                percent: cloudUsage.compute.ocpusPercent,
                status: cloudUsage.compute.status,
                unit: "OCPU",
                suffix: "",
              },
              {
                label: "Compute: memory",
                used: cloudUsage.compute.memoryGbUsed,
                cap: cloudUsage.compute.memoryGbCap,
                percent: cloudUsage.compute.memoryPercent,
                status: cloudUsage.compute.status,
                unit: "GB",
                suffix: "",
              },
              {
                label: "OCI block volume usage",
                used: cloudUsage.blockStorage.gbUsed,
                cap: cloudUsage.blockStorage.gbCap,
                percent: cloudUsage.blockStorage.percent,
                status: cloudUsage.blockStorage.status,
                unit: "GB",
                suffix: ` · ${cloudUsage.blockStorage.volumeCount} volume${cloudUsage.blockStorage.volumeCount === 1 ? "" : "s"}`,
              },
              {
                label: "Load balancers",
                used: cloudUsage.loadBalancers.count,
                cap: cloudUsage.loadBalancers.cap,
                percent: cloudUsage.loadBalancers.percent,
                status: cloudUsage.loadBalancers.status,
                unit: "",
                suffix: "",
              },
            ].map((bar) => (
              <div key={bar.label} style={{ marginTop: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                  <span style={{ color: "#344054", fontSize: 13 }}>
                    {bar.label}{" "}
                    <span style={{ color: "#98a2b3" }}>
                      {bar.used.toLocaleString()} / {bar.cap.toLocaleString()} {bar.unit}
                      {bar.suffix}
                    </span>
                  </span>
                  <span style={{ color: STATUS_COLOR[bar.status], fontWeight: 700, fontSize: 16 }}>{Math.round(bar.percent)}%</span>
                </div>
                <div style={{ background: "#eaecf0", borderRadius: 6, height: 8, overflow: "hidden" }}>
                  <div style={{ width: `${Math.min(100, bar.percent)}%`, background: STATUS_COLOR[bar.status], height: "100%" }} />
                </div>
                <div style={{ color: "#667085", fontSize: 12, marginTop: 3 }}>{roomLeft(bar.used, bar.cap, bar.unit)}</div>
              </div>
            ))}

            <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ color: "#98a2b3", fontSize: 12 }}>
                {cloudUsage.checkedAt ? `Last checked: ${new Date(cloudUsage.checkedAt).toLocaleString()}` : ""}
              </span>
              <button
                type="button"
                className="secondary"
                disabled={refreshingCloudUsage}
                onClick={() => loadCloudUsage(true)}
                style={{ padding: "4px 10px", fontSize: 12.5 }}
              >
                {refreshingCloudUsage ? "Refreshing…" : "Refresh"}
              </button>
            </div>
            {cloudUsage.alerts && (
              <p style={{ color: "#667085", fontSize: 12.5, marginTop: 10 }}>
                {cloudUsage.alerts.emailConfigured && cloudUsage.alerts.recipients.length > 0
                  ? `Email alert: on. You are emailed at ${cloudUsage.alerts.thresholdPercent}% of any free limit, if one is exceeded, or if a charge appears (sent to ${cloudUsage.alerts.recipients.join(", ")}).`
                  : `Email alert: not active yet. It needs outgoing email (SMTP settings) on the server; once those are added it starts automatically at ${cloudUsage.alerts.thresholdPercent}% of any free limit.`}
                {cloudUsage.alerts.lastAlertAt && ` Last alert sent ${new Date(cloudUsage.alerts.lastAlertAt).toLocaleString()}.`}
              </p>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h2>Clients</h2>
        {clients.length === 0 ? (
          <p style={{ color: "#98a2b3" }}>No client companies yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Code</th>
                <th>Status</th>
                <th>Users</th>
                <th>Storage</th>
                <th>Modules</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td>{c.tradeName || c.legalName}</td>
                  <td>{c.code}</td>
                  <td>
                    <span className={`badge ${c.isActive ? "posted" : "draft"}`}>
                      {c.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    {c.activeUserCount} / {c.userCount} active
                  </td>
                  <td>{formatBytes(c.storageBytes)}</td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      {ALL_MODULES.map((moduleKey) => (
                        <label key={moduleKey} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                          <input
                            type="checkbox"
                            checked={c.enabledModules.includes(moduleKey)}
                            disabled={savingId === c.id}
                            onChange={() => toggleModule(c, moduleKey)}
                          />
                          {MODULE_LABELS[moduleKey]}
                        </label>
                      ))}
                    </div>
                  </td>
                  <td>{new Date(c.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
