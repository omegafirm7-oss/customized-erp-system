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
  compute: { ocpusUsed: number; ocpusCap: number; memoryGbUsed: number; memoryGbCap: number; status: UsageStatus };
  blockStorage: { gbUsed: number; gbCap: number; volumeCount: number; status: UsageStatus };
  loadBalancers: { count: number; cap: number; status: UsageStatus };
  error?: string;
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
            {cloudUsage.cost && (
              <div style={{ marginBottom: 16 }}>
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

            {(
              [
                {
                  label: "Compute — OCPUs",
                  used: cloudUsage.compute.ocpusUsed,
                  cap: cloudUsage.compute.ocpusCap,
                  status: cloudUsage.compute.status,
                  unit: "OCPU",
                  suffix: undefined as string | undefined,
                },
                {
                  label: "Compute — memory",
                  used: cloudUsage.compute.memoryGbUsed,
                  cap: cloudUsage.compute.memoryGbCap,
                  status: cloudUsage.compute.status,
                  unit: "GB",
                  suffix: undefined as string | undefined,
                },
                {
                  label: "OCI block volume usage",
                  used: cloudUsage.blockStorage.gbUsed,
                  cap: cloudUsage.blockStorage.gbCap,
                  status: cloudUsage.blockStorage.status,
                  unit: "GB",
                  suffix: `${cloudUsage.blockStorage.volumeCount} volume${cloudUsage.blockStorage.volumeCount === 1 ? "" : "s"}` as string | undefined,
                },
                {
                  label: "Load balancers",
                  used: cloudUsage.loadBalancers.count,
                  cap: cloudUsage.loadBalancers.cap,
                  status: cloudUsage.loadBalancers.status,
                  unit: "",
                  suffix: undefined as string | undefined,
                },
              ]
            ).map((bar) => {
              const pct = bar.cap > 0 ? Math.min(100, (bar.used / bar.cap) * 100) : 0;
              return (
                <div key={bar.label} style={{ marginTop: 12 }}>
                  <p style={{ color: "#667085", marginBottom: 4, fontSize: 13 }}>
                    {bar.label}: {bar.used.toLocaleString()} / {bar.cap.toLocaleString()} {bar.unit}
                    {bar.suffix ? ` (${bar.suffix})` : ""}
                  </p>
                  <div style={{ background: "#eaecf0", borderRadius: 6, height: 8, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, background: STATUS_COLOR[bar.status], height: "100%" }} />
                  </div>
                </div>
              );
            })}

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
