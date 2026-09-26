import { useCallback, useEffect, useMemo, useState } from "react";
import { apiClient } from "../api/client";

type Status = "PENDING" | "VALID" | "INVALID" | "FAILED";

interface Submission {
  id: string;
  channel: "DI" | "POS";
  environment: "MOCK" | "SANDBOX" | "PRODUCTION";
  status: Status;
  fbrInvoiceNumber: string | null;
  errors: Array<{ code: string; message: string; itemSNo?: string }> | null;
  retryCount: number;
  lastAttemptAt: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
  salesInvoice: { id: string; invoiceNumber: string | null; grossTotal: string; documentKind: string; buyerNameSnapshot: string | null };
}

interface Summary {
  byChannelAndStatus: Array<{ channel: "DI" | "POS"; status: Status; count: number }>;
  unreportedPostedInvoices: number;
}

const STATUS_CLASS: Record<Status, string> = { VALID: "posted", PENDING: "draft", FAILED: "reversed", INVALID: "reversed" };
const STATUS_HELP: Record<Status, string> = {
  VALID: "Accepted — FBR invoice number issued",
  PENDING: "Waiting — FBR unreachable, retried automatically",
  FAILED: "Token rejected by FBR — check FBR Settings",
  INVALID: "Rejected by FBR — fix the data shown, then Retry",
};

export function FbrSubmissionsPage() {
  const [rows, setRows] = useState<Submission[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [statusFilter, setStatusFilter] = useState<"" | Status>("");
  const [channelFilter, setChannelFilter] = useState<"" | "DI" | "POS">("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (channelFilter) params.set("channel", channelFilter);
    const [list, sum] = await Promise.all([
      apiClient.get<Submission[]>(`/fbr/submissions?${params.toString()}`),
      apiClient.get<Summary>("/fbr/submissions/summary"),
    ]);
    setRows(list.data);
    setSummary(sum.data);
  }, [statusFilter, channelFilter]);

  useEffect(() => {
    load().catch((err) => setError(err?.response?.data?.message ?? "Failed to load FBR submissions"));
  }, [load]);

  const totals = useMemo(() => {
    const count = (status: Status) => summary?.byChannelAndStatus.filter((r) => r.status === status).reduce((s, r) => s + r.count, 0) ?? 0;
    return { VALID: count("VALID"), PENDING: count("PENDING"), INVALID: count("INVALID"), FAILED: count("FAILED") };
  }, [summary]);

  async function retry(row: Submission) {
    setError(null);
    setBusyId(row.id);
    try {
      await apiClient.post(`/fbr/submissions/${row.id}/retry`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Retry failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>FBR Submissions</h2>
        <p className="muted">
          Every posted sales invoice (Digital Invoicing) and POS sale (IMS) and its reporting status. Pending and failed
          submissions are retried automatically every few minutes; rejected ones need their data fixed first.
        </p>
        {error && <div className="error-banner" style={{ whiteSpace: "pre-line" }}>{error}</div>}
        <div className="kpi-grid">
          {(["VALID", "PENDING", "INVALID", "FAILED"] as Status[]).map((status) => (
            <button
              key={status}
              type="button"
              className="kpi-tile"
              style={{ textAlign: "left", cursor: "pointer", border: statusFilter === status ? "2px solid #2e90fa" : undefined }}
              onClick={() => setStatusFilter(statusFilter === status ? "" : status)}
              title={STATUS_HELP[status]}
            >
              <div className="kpi-label">{status === "VALID" ? "Accepted" : status.charAt(0) + status.slice(1).toLowerCase()}</div>
              <div className="kpi-value">{totals[status]}</div>
            </button>
          ))}
          <div className="kpi-tile" title="Posted before FBR reporting was enabled">
            <div className="kpi-label">Never reported</div>
            <div className="kpi-value">{summary?.unreportedPostedInvoices ?? 0}</div>
          </div>
        </div>
        <div className="form-row">
          <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value as "" | "DI" | "POS")}>
            <option value="">All channels</option>
            <option value="DI">Digital Invoicing</option>
            <option value="POS">POS (IMS)</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "" | Status)}>
            <option value="">All statuses</option>
            {(["VALID", "PENDING", "INVALID", "FAILED"] as Status[]).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button type="button" className="secondary" onClick={() => load()}>Refresh</button>
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Buyer</th>
              <th style={{ textAlign: "right" }}>Total</th>
              <th>Channel</th>
              <th>Status</th>
              <th>FBR invoice number</th>
              <th>Attempts</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">No submissions.</td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  {row.salesInvoice.invoiceNumber}
                  {row.salesInvoice.documentKind === "CREDIT_NOTE" && <span className="badge draft" style={{ marginLeft: 6 }}>return</span>}
                </td>
                <td>{row.salesInvoice.buyerNameSnapshot ?? "—"}</td>
                <td style={{ textAlign: "right" }}>{Number(row.salesInvoice.grossTotal).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td>
                  {row.channel === "DI" ? "Digital Invoicing" : "POS"}
                  {row.environment !== "PRODUCTION" && <span className="badge warning" style={{ marginLeft: 6 }}>{row.environment.toLowerCase()}</span>}
                </td>
                <td>
                  <span className={`badge ${STATUS_CLASS[row.status]}`} title={STATUS_HELP[row.status]}>{row.status}</span>
                  {row.errors && row.status !== "VALID" && (
                    <div className="muted" style={{ marginTop: 4, maxWidth: 360 }}>
                      {row.errors.map((e, i) => (
                        <div key={i}>
                          {e.itemSNo ? `Line ${e.itemSNo}: ` : ""}[{e.code}] {e.message}
                        </div>
                      ))}
                    </div>
                  )}
                </td>
                <td style={{ fontFamily: "monospace", fontSize: 12 }}>{row.fbrInvoiceNumber ?? "—"}</td>
                <td>{row.retryCount}</td>
                <td>
                  {row.status !== "VALID" && (
                    <button className="secondary" disabled={busyId === row.id} onClick={() => retry(row)}>
                      {busyId === row.id ? "Sending…" : "Retry"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
