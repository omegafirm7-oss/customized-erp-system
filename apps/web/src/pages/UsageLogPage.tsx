import { Fragment, useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiClient } from "../api/client";
import { AttachButton } from "../components/AttachButton";
import { AttachmentViewer } from "../components/AttachmentViewer";

interface Entry {
  id: string;
  assignmentId: string;
  date: string;
  dayStatus: string;
  hoursUsed: string;
  overtimeHours: string;
  attachment: { filename: string } | null;
}

interface AssignmentRef {
  id: string;
  rateBasis: string;
  billRate: string;
  equipment: { code: string; name: string };
}

interface UsageLogDetail {
  id: string;
  status: string;
  contract: {
    id: string;
    code: string;
    name: string;
    businessPartner: { code: string; name: string };
    assignments: AssignmentRef[];
  };
  fiscalPeriod: { periodNumber: number; startDate: string; endDate: string };
  salesInvoice: { id: string; invoiceNumber: string | null; status: string } | null;
  entries: Entry[];
}

type Tab = "days" | "overtime" | "attachments";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "days", label: "Days" },
  { id: "overtime", label: "Overtime" },
  { id: "attachments", label: "Attachments" },
];

const DAY_STATUSES = [
  { value: "ON_RENT", label: "R" },
  { value: "IDLE", label: "I" },
  { value: "BREAKDOWN", label: "B" },
];

// Hiace vans, buses, and other project-assigned equipment all run their day
// logging, overtime, and attached evidence through this same usage-log grid.
export function UsageLogPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [usageLog, setUsageLog] = useState<UsageLogDetail | null>(null);
  const [tab, setTab] = useState<Tab>("days");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ entryId: string; filename: string } | null>(null);

  const load = useCallback(async () => {
    const res = await apiClient.get<UsageLogDetail>(`/equipment/usage-logs/${id}`);
    setUsageLog(res.data);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function updateEntry(entry: Entry, patch: { dayStatus?: string; hoursUsed?: string; overtimeHours?: string }) {
    setError(null);
    try {
      await apiClient.post(`/equipment/usage-logs/${id}/entries`, {
        assignmentId: entry.assignmentId,
        date: entry.date.slice(0, 10),
        dayStatus: patch.dayStatus ?? entry.dayStatus,
        hoursUsed: patch.hoursUsed ?? entry.hoursUsed,
        overtimeHours: patch.overtimeHours ?? entry.overtimeHours,
      });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to update entry");
    }
  }

  async function uploadAttachment(entryId: string, file: File) {
    setError(null);
    setUploadingFor(entryId);
    try {
      const form = new FormData();
      form.append("file", file);
      await apiClient.post(`/equipment/usage-logs/entries/${entryId}/attachment`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Upload failed");
    } finally {
      setUploadingFor(null);
    }
  }

  async function action(path: string, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setError(null);
    setBusy(true);
    try {
      await apiClient.post(`/equipment/usage-logs/${id}/${path}`);
      if (path === "generate-invoice") {
        navigate(`/ar/invoices`);
        return;
      }
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? `${path} failed`);
    } finally {
      setBusy(false);
    }
  }

  if (!usageLog) return <p>Loading…</p>;

  const isDraft = usageLog.status === "DRAFT";
  const assignments = usageLog.contract.assignments;
  const entriesByKey = new Map(usageLog.entries.map((e) => [`${e.assignmentId}|${e.date.slice(0, 10)}`, e]));
  const dates = [...new Set(usageLog.entries.map((e) => e.date.slice(0, 10)))].sort();
  const attachmentCount = usageLog.entries.filter((e) => e.attachment).length;

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>
            Usage log — <Link to={`/equipment/contracts/${usageLog.contract.id}`}>{usageLog.contract.code}</Link> ·
            Period {usageLog.fiscalPeriod.periodNumber}{" "}
            <span className={`badge ${usageLog.status === "INVOICED" ? "posted" : "draft"}`}>{usageLog.status}</span>
          </h2>
          <span>
            {isDraft && (
              <>
                <button className="secondary" onClick={() => action("prefill")} disabled={busy}>
                  Prefill missing days
                </button>{" "}
                <button onClick={() => action("approve", "Approve this usage log? Entries lock afterwards.")} disabled={busy}>
                  Approve
                </button>
              </>
            )}
            {usageLog.status === "APPROVED" && (
              <>
                <button className="secondary" onClick={() => action("reopen")} disabled={busy}>
                  Reopen
                </button>{" "}
                <button onClick={() => action("generate-invoice", "Generate the AR draft invoice from this usage log?")} disabled={busy}>
                  Generate invoice
                </button>
              </>
            )}
            {usageLog.status === "INVOICED" && usageLog.salesInvoice && (
              <>
                Invoice {usageLog.salesInvoice.invoiceNumber ?? "(draft)"} — {usageLog.salesInvoice.status}{" "}
                {usageLog.salesInvoice.status === "CANCELLED" && (
                  <button className="secondary" onClick={() => action("reopen")} disabled={busy}>
                    Reopen for re-billing
                  </button>
                )}
              </>
            )}
          </span>
        </div>
        {error && <div className="error-banner">{error}</div>}
      </div>

      <div className="card">
        <div className="tab-row">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={tab === t.id ? "" : "secondary"}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.id === "attachments" && attachmentCount > 0 ? ` (${attachmentCount})` : ""}
            </button>
          ))}
        </div>

        {tab === "days" && (
          <p style={{ color: "#667085", fontSize: 13 }}>
            R = on rent · I = idle (still billable) · B = breakdown (downtime credit, not billed). Hours drive
            hourly-basis billing.
          </p>
        )}
        {tab === "overtime" && (
          <p style={{ color: "#667085", fontSize: 13 }}>
            Overtime hours are recorded here for reporting only — they do not change billing or the assignment's
            metered hours.
          </p>
        )}
        {tab === "attachments" && (
          <p style={{ color: "#667085", fontSize: 13 }}>
            Attach evidence to a single day — a signed site sheet, a gate pass, a photo. One file per equipment per
            day; attach again to replace it.
          </p>
        )}

        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                {assignments.map((a) =>
                  tab === "days" ? (
                    <th key={a.id} colSpan={2}>
                      {a.equipment.code} ({a.rateBasis.toLowerCase()})
                    </th>
                  ) : (
                    <th key={a.id}>{a.equipment.code}</th>
                  ),
                )}
              </tr>
              <tr>
                <th></th>
                {assignments.map((a) =>
                  tab === "days" ? (
                    <Fragment key={a.id}>
                      <th>Day</th>
                      <th>Hours</th>
                    </Fragment>
                  ) : (
                    <th key={a.id}>{tab === "overtime" ? "OT hrs" : "File"}</th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {dates.map((date) => (
                <tr key={date}>
                  <td>{new Date(date).toLocaleDateString(undefined, { day: "numeric", month: "short", weekday: "short" })}</td>
                  {assignments.map((a) => {
                    const entry = entriesByKey.get(`${a.id}|${date}`);
                    if (!entry) {
                      return tab === "days" ? (
                        <Fragment key={a.id}>
                          <td>—</td>
                          <td>—</td>
                        </Fragment>
                      ) : (
                        <td key={a.id}>—</td>
                      );
                    }

                    if (tab === "days") {
                      return (
                        <Fragment key={a.id}>
                          <td>
                            {isDraft ? (
                              <select value={entry.dayStatus} onChange={(e) => updateEntry(entry, { dayStatus: e.target.value })}>
                                {DAY_STATUSES.map((ds) => (
                                  <option key={ds.value} value={ds.value}>
                                    {ds.label}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              DAY_STATUSES.find((ds) => ds.value === entry.dayStatus)?.label
                            )}
                          </td>
                          <td>
                            {isDraft ? (
                              <input
                                type="number"
                                min="0"
                                step="0.5"
                                style={{ width: 55 }}
                                defaultValue={Number(entry.hoursUsed) || ""}
                                onBlur={(e) => {
                                  const v = e.target.value || "0";
                                  if (v !== entry.hoursUsed) updateEntry(entry, { hoursUsed: v });
                                }}
                              />
                            ) : (
                              Number(entry.hoursUsed) || "—"
                            )}
                          </td>
                        </Fragment>
                      );
                    }

                    if (tab === "overtime") {
                      return (
                        <td key={a.id}>
                          {isDraft ? (
                            <input
                              type="number"
                              min="0"
                              step="0.5"
                              style={{ width: 55 }}
                              defaultValue={Number(entry.overtimeHours) || ""}
                              onBlur={(e) => {
                                const v = e.target.value || "0";
                                if (v !== entry.overtimeHours) updateEntry(entry, { overtimeHours: v });
                              }}
                            />
                          ) : (
                            Number(entry.overtimeHours) || "—"
                          )}
                        </td>
                      );
                    }

                    return (
                      <td key={a.id}>
                        {entry.attachment ? (
                          <button
                            className="secondary"
                            style={{ padding: "2px 8px", fontSize: 12 }}
                            onClick={() => setViewer({ entryId: entry.id, filename: entry.attachment!.filename })}
                          >
                            View
                          </button>
                        ) : (
                          <AttachButton
                            uploading={uploadingFor === entry.id}
                            onFile={(file) => uploadAttachment(entry.id, file)}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {viewer && (
        <AttachmentViewer
          filename={viewer.filename}
          fetchBlob={() =>
            apiClient
              .get(`/equipment/usage-logs/entries/${viewer.entryId}/attachment`, { responseType: "blob" })
              .then((res) => res.data as Blob)
          }
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}
