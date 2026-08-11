import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiClient } from "../api/client";

interface Entry {
  id: string;
  assignmentId: string;
  date: string;
  dayType: string;
  hours: string;
  overtimeHours: string;
}

interface AssignmentRef {
  id: string;
  rateBasis: string;
  billRate: string;
  equipmentName: string;
}

interface TimesheetDetail {
  id: string;
  status: string;
  contract: {
    id: string;
    code: string;
    name: string;
    businessPartner: { code: string; name: string };
    project: { code: string; name: string };
    assignments: AssignmentRef[];
  };
  fiscalPeriod: { periodNumber: number; startDate: string; endDate: string };
  purchaseInvoice: { id: string; invoiceNumber: string | null; status: string } | null;
  entries: Entry[];
}

const DAY_TYPES = [
  { value: "WORKED", label: "W" },
  { value: "IDLE", label: "I" },
  { value: "BREAKDOWN", label: "B" },
  { value: "OFF", label: "O" },
];

export function HiredEquipmentTimesheetPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [timesheet, setTimesheet] = useState<TimesheetDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await apiClient.get<TimesheetDetail>(`/hired-equipment/timesheets/${id}`);
    setTimesheet(res.data);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function updateEntry(entry: Entry, patch: { dayType?: string; hours?: string; overtimeHours?: string }) {
    setError(null);
    try {
      await apiClient.post(`/hired-equipment/timesheets/${id}/entries`, {
        assignmentId: entry.assignmentId,
        date: entry.date.slice(0, 10),
        dayType: patch.dayType ?? entry.dayType,
        hours: patch.hours ?? entry.hours,
        overtimeHours: patch.overtimeHours ?? entry.overtimeHours,
      });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to update entry");
    }
  }

  async function action(path: string, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setError(null);
    setBusy(true);
    try {
      const res = await apiClient.post(`/hired-equipment/timesheets/${id}/${path}`);
      if (path === "generate-invoice") {
        navigate(`/ap/invoices`);
        return res.data;
      }
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? `${path} failed`);
    } finally {
      setBusy(false);
    }
  }

  if (!timesheet) return <p>Loading…</p>;

  const isDraft = timesheet.status === "DRAFT";
  const assignments = timesheet.contract.assignments;
  const entriesByKey = new Map(timesheet.entries.map((e) => [`${e.assignmentId}|${e.date.slice(0, 10)}`, e]));
  const dates = [...new Set(timesheet.entries.map((e) => e.date.slice(0, 10)))].sort();

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>
          Timesheet — <Link to={`/hired-equipment/contracts/${timesheet.contract.id}`}>{timesheet.contract.code}</Link> ·
          Period {timesheet.fiscalPeriod.periodNumber}{" "}
          <span className={`badge ${timesheet.status === "INVOICED" ? "posted" : "draft"}`}>{timesheet.status}</span>
        </h2>
        <span>
          {isDraft && (
            <>
              <button className="secondary" onClick={() => action("prefill")} disabled={busy}>
                Prefill missing days
              </button>{" "}
              <button onClick={() => action("approve", "Approve this timesheet? Entries lock afterwards.")} disabled={busy}>
                Approve
              </button>
            </>
          )}
          {timesheet.status === "APPROVED" && (
            <>
              <button className="secondary" onClick={() => action("reopen")} disabled={busy}>
                Reopen
              </button>{" "}
              <button onClick={() => action("generate-invoice", "Generate the vendor AP draft invoice from this timesheet?")} disabled={busy}>
                Generate invoice
              </button>
            </>
          )}
          {timesheet.status === "INVOICED" && timesheet.purchaseInvoice && (
            <>
              Invoice {timesheet.purchaseInvoice.invoiceNumber ?? "(draft)"} — {timesheet.purchaseInvoice.status}{" "}
              {timesheet.purchaseInvoice.status === "CANCELLED" && (
                <button className="secondary" onClick={() => action("reopen")} disabled={busy}>
                  Reopen for re-billing
                </button>
              )}
            </>
          )}
        </span>
      </div>
      {error && <div className="error-banner">{error}</div>}
      <p style={{ color: "#667085", fontSize: 13 }}>
        W = worked (billable) · I = idle on site · B = breakdown · O = off (holiday). <strong>Hourly</strong> equipment
        bills the Hours you enter on worked days. <strong>Daily</strong> equipment bills a fixed amount per day marked
        W, regardless of hours. <strong>Monthly</strong> equipment bills the full fixed rate for the period —
        you don't need to fill in anything here at all; just create the timesheet, approve it, and generate the
        invoice.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              {assignments.map((a) => (
                <th key={a.id} colSpan={3}>
                  {a.equipmentName} ({a.rateBasis.toLowerCase()})
                </th>
              ))}
            </tr>
            <tr>
              <th></th>
              {assignments.map((a) => (
                <>
                  <th key={`${a.id}-d`}>Day</th>
                  <th key={`${a.id}-h`}>Hours</th>
                  <th key={`${a.id}-o`}>OT</th>
                </>
              ))}
            </tr>
          </thead>
          <tbody>
            {dates.map((date) => (
              <tr key={date}>
                <td>{new Date(date).toLocaleDateString(undefined, { day: "numeric", month: "short", weekday: "short" })}</td>
                {assignments.map((a) => {
                  const entry = entriesByKey.get(`${a.id}|${date}`);
                  if (!entry) {
                    return (
                      <>
                        <td key={`${a.id}-d`}>—</td>
                        <td key={`${a.id}-h`}>—</td>
                        <td key={`${a.id}-o`}>—</td>
                      </>
                    );
                  }
                  return (
                    <>
                      <td key={`${a.id}-d`}>
                        {isDraft ? (
                          <select value={entry.dayType} onChange={(e) => updateEntry(entry, { dayType: e.target.value })}>
                            {DAY_TYPES.map((dt) => (
                              <option key={dt.value} value={dt.value}>
                                {dt.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          DAY_TYPES.find((dt) => dt.value === entry.dayType)?.label
                        )}
                      </td>
                      <td key={`${a.id}-h`}>
                        {isDraft ? (
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            style={{ width: 55 }}
                            defaultValue={Number(entry.hours) || ""}
                            onBlur={(e) => {
                              const v = e.target.value || "0";
                              if (v !== entry.hours) updateEntry(entry, { hours: v });
                            }}
                          />
                        ) : (
                          Number(entry.hours) || "—"
                        )}
                      </td>
                      <td key={`${a.id}-o`}>
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
                    </>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
