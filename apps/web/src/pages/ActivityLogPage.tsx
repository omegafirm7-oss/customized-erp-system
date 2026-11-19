import { useCallback, useEffect, useState } from "react";
import { apiClient } from "../api/client";

interface ActivityLogRow {
  id: string;
  changedAt: string;
  action: string;
  entityName: string;
  entityId: string;
  ipAddress: string | null;
  userAgent: string | null;
  user: { id: string; email: string; fullName: string } | null;
  /** For downloads: what was taken. */
  details: { employeeCode?: string; employeeName?: string; period?: string | null; via?: string; sentTo?: string | null } | null;
}

interface CompanyUserRow {
  userId: string;
  email: string;
  fullName: string;
}

const ACTIONS = ["LOGIN", "LOGOUT", "DOWNLOAD", "SHARE", "CREATE", "UPDATE", "DELETE", "POST", "REVERSE", "CLOSE"];

const ACTION_LABELS: Record<string, string> = {
  LOGIN: "Logged in",
  LOGOUT: "Logged out",
  CREATE: "Created",
  UPDATE: "Updated",
  DELETE: "Deleted",
  POST: "Posted",
  REVERSE: "Reversed",
  CLOSE: "Closed",
  DOWNLOAD: "Downloaded",
  SHARE: "Shared via WhatsApp",
};

const PAGE_SIZE = 50;

export function ActivityLogPage() {
  const [rows, setRows] = useState<ActivityLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<CompanyUserRow[]>([]);

  const [userId, setUserId] = useState("");
  const [action, setAction] = useState("");
  const [entityName, setEntityName] = useState("");
  const [recordTypes, setRecordTypes] = useState<string[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    apiClient
      .get<CompanyUserRow[]>("/iam/company-users")
      .then((res) => setUsers(res.data))
      .catch(() => {
        // Non-fatal — the filter dropdown just stays empty if this fails
        // (e.g. a role that can view the log but not manage users).
      });
  }, []);

  useEffect(() => {
    apiClient
      .get<Array<{ entityName: string }>>("/audit/activity-log/record-types")
      .then((res) => setRecordTypes(res.data.map((r) => r.entityName)))
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ items: ActivityLogRow[]; total: number }>("/audit/activity-log", {
        params: {
          userId: userId || undefined,
          action: action || undefined,
          entityName: entityName || undefined,
          from: from ? new Date(from).toISOString() : undefined,
          to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
          page,
          pageSize: PAGE_SIZE,
        },
      });
      setRows(res.data.items);
      setTotal(res.data.total);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to load activity log");
    } finally {
      setLoading(false);
    }
  }, [userId, action, entityName, from, to, page]);

  useEffect(() => {
    load();
  }, [load]);

  function applyFilters() {
    setPage(1);
    load();
  }

  /** One click to see who took a timesheet and when. */
  function showTimesheetDownloads() {
    setUserId("");
    setAction("DOWNLOAD");
    setEntityName("Timesheet PDF");
    setFrom("");
    setTo("");
    setPage(1);
  }

  /** One click to see every timesheet sent over WhatsApp, and to which number. */
  function showTimesheetShares() {
    setUserId("");
    setAction("SHARE");
    setEntityName("Timesheet PDF");
    setFrom("");
    setTo("");
    setPage(1);
  }

  function clearFilters() {
    setUserId("");
    setAction("");
    setEntityName("");
    setFrom("");
    setTo("");
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="card">
      <h2>Activity Log</h2>
      <p style={{ color: "#667085", fontSize: 13 }}>
        Every login/logout and every record created, changed, posted, or deleted by a user in this company — newest
        first.
      </p>
      {error && <div className="error-banner">{error}</div>}

      <div className="form-row" style={{ marginTop: 12, marginBottom: 12 }}>
        <select value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">All users</option>
          {users.map((u) => (
            <option key={u.userId} value={u.userId}>
              {u.fullName} ({u.email})
            </option>
          ))}
        </select>
        <select value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All activity</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {ACTION_LABELS[a]}
            </option>
          ))}
        </select>
        <select value={entityName} onChange={(e) => setEntityName(e.target.value)}>
          <option value="">All record types</option>
          {[...new Set([...recordTypes, ...(entityName ? [entityName] : [])])].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <div>
          <label>From </label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label>To </label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button onClick={applyFilters}>Apply</button>
        <button className="secondary" onClick={clearFilters}>
          Clear
        </button>
        <button className="secondary" onClick={showTimesheetDownloads} title="Show who downloaded a timesheet PDF">
          Timesheet downloads
        </button>
        <button className="secondary" onClick={showTimesheetShares} title="Show who sent a timesheet PDF over WhatsApp, and to which number">
          Timesheet WhatsApp shares
        </button>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>User</th>
                <th>Activity</th>
                <th>Record</th>
                <th>Details</th>
                <th>IP Address</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const dt = new Date(r.changedAt);
                return (
                  <tr key={r.id}>
                    <td>{dt.toLocaleDateString()}</td>
                    <td>{dt.toLocaleTimeString()}</td>
                    <td>{r.user ? `${r.user.fullName} (${r.user.email})` : "—"}</td>
                    <td>
                      <span className={`badge ${r.action === "LOGIN" ? "posted" : r.action === "DELETE" ? "reversed" : "draft"}`}>
                        {ACTION_LABELS[r.action] ?? r.action}
                      </span>
                    </td>
                    <td>{r.entityName}</td>
                    <td>
                      {r.details
                        ? [r.details.employeeCode && r.details.employeeName ? `${r.details.employeeCode} ${r.details.employeeName}` : null, r.details.period, r.details.via, r.details.via === "Sent via WhatsApp" ? (r.details.sentTo ? `to ${r.details.sentTo}` : r.details.sentTo === null ? "recipient chosen by hand (no phone saved)" : "recipient not recorded") : null].filter(Boolean).join(" · ")
                        : "—"}
                    </td>
                    <td>{r.ipAddress ?? "—"}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ color: "#98a2b3" }}>
                    No activity recorded for this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="form-row" style={{ justifyContent: "space-between", marginTop: 12 }}>
            <span style={{ color: "#667085", fontSize: 13 }}>
              Page {page} of {totalPages} — {total} record{total === 1 ? "" : "s"}
            </span>
            <span>
              <button className="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>{" "}
              <button className="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
