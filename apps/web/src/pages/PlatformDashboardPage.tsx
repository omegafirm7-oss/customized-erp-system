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

export function PlatformDashboardPage() {
  const [summary, setSummary] = useState<PlatformSummary | null>(null);
  const [clients, setClients] = useState<PlatformClient[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

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
          {formatBytes(summary.totalStorageBytes)} used of {formatBytes(summary.storageLimitBytes)} Oracle Cloud
          Always Free allowance ({summary.storageUsedPercent}%)
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
