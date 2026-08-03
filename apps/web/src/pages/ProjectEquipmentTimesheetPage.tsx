import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiClient } from "../api/client";
import { AttachButton } from "../components/AttachButton";
import { AttachmentViewer } from "../components/AttachmentViewer";
import { formatPeriodLabel } from "../utils/period";

interface FiscalPeriod {
  id: string;
  periodNumber: number;
  startDate: string;
  endDate: string;
}

interface EquipmentEntry {
  id: string;
  date: string;
  used: boolean;
  hoursUsed: string;
  overtimeHours: string;
}

interface EquipmentAssignmentRow {
  assignmentId: string;
  equipmentCode: string;
  equipmentName: string;
  dayRate: string;
  isActive: boolean;
  entries: EquipmentEntry[];
}

interface TimesheetResponse {
  fiscalPeriodId: string;
  periodStart: string;
  periodEnd: string;
  periodAttachmentFilename: string | null;
  assignments: EquipmentAssignmentRow[];
}

interface EquipmentUnit {
  id: string;
  code: string;
  name: string;
  internalDayRate: string | null;
}

type Tab = "days" | "overtime" | "attachments";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "days", label: "Days" },
  { id: "overtime", label: "Overtime" },
  { id: "attachments", label: "Attachments" },
];

function money(v: string | number): string {
  return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Vehicles/equipment used on our own projects — Hiace vans, buses, etc. —
// never billed to a customer (that's Equipment Contracts + Usage Logs).
// Accrued cost here is a flat dayRate per day marked used, rolled into
// this project's Machinery Cost on the Project Intelligence dashboard.
export function ProjectEquipmentTimesheetPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [periodId, setPeriodId] = useState("");
  const [tab, setTab] = useState<Tab>("days");
  const [timesheet, setTimesheet] = useState<TimesheetResponse | null>(null);
  const [units, setUnits] = useState<EquipmentUnit[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingPeriodAttachment, setUploadingPeriodAttachment] = useState(false);
  const [viewingPeriodAttachment, setViewingPeriodAttachment] = useState(false);
  const [assignForm, setAssignForm] = useState({ equipmentId: "", startDate: "", dayRate: "" });

  useEffect(() => {
    apiClient.get<FiscalPeriod[]>("/companies/current/fiscal-periods").then((res) => {
      const list = res.data;
      setPeriods(list);
      const requested = searchParams.get("period");
      const requestedValid = requested && list.some((p) => p.id === requested);
      if (requestedValid) {
        setPeriodId(requested as string);
        return;
      }
      const now = Date.now();
      const current = list.find((p) => new Date(p.startDate).getTime() <= now && now <= new Date(p.endDate).getTime());
      setPeriodId(current?.id ?? list[0]?.id ?? "");
    });
    apiClient.get<EquipmentUnit[]>("/equipment/units").then((res) => setUnits(res.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    if (!projectId || !periodId) return;
    const res = await apiClient.get<TimesheetResponse>(`/equipment/projects/${projectId}/timesheet?fiscalPeriodId=${periodId}`);
    setTimesheet(res.data);
  }, [projectId, periodId]);

  useEffect(() => {
    if (!periodId) return;
    setLoading(true);
    setError(null);
    load()
      .catch((err: any) => setError(err?.response?.data?.message ?? "Failed to load timesheet"))
      .finally(() => setLoading(false));
  }, [periodId, load]);

  async function manualRefill() {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(`/equipment/projects/${projectId}/timesheet/prefill?fiscalPeriodId=${periodId}`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Refill failed");
    } finally {
      setBusy(false);
    }
  }

  async function updateEntry(entry: EquipmentEntry, assignmentId: string, patch: { used?: boolean; hoursUsed?: string; overtimeHours?: string }) {
    setError(null);
    try {
      await apiClient.post(`/equipment/projects/${projectId}/timesheet/entries`, {
        assignmentId,
        date: entry.date.slice(0, 10),
        used: patch.used ?? entry.used,
        hoursUsed: patch.hoursUsed ?? entry.hoursUsed,
        overtimeHours: patch.overtimeHours ?? entry.overtimeHours,
      });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to update entry");
    }
  }

  async function assignEquipment(e: React.FormEvent) {
    e.preventDefault();
    if (!assignForm.equipmentId || !assignForm.startDate) return;
    setError(null);
    setBusy(true);
    try {
      await apiClient.post("/equipment/project-assignments", {
        projectId,
        equipmentId: assignForm.equipmentId,
        startDate: assignForm.startDate,
        dayRate: assignForm.dayRate || undefined,
      });
      setAssignForm({ equipmentId: "", startDate: "", dayRate: "" });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to assign equipment");
    } finally {
      setBusy(false);
    }
  }

  async function endAssignment(assignmentId: string) {
    if (!window.confirm("End this equipment's assignment to the project?")) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(`/equipment/project-assignments/${assignmentId}/end`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to end assignment");
    } finally {
      setBusy(false);
    }
  }

  async function uploadPeriodAttachment(file: File) {
    setError(null);
    setUploadingPeriodAttachment(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await apiClient.post(`/equipment/projects/${projectId}/period-attachment?fiscalPeriodId=${periodId}`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Upload failed");
    } finally {
      setUploadingPeriodAttachment(false);
    }
  }

  const dates = timesheet ? [...new Set(timesheet.assignments.flatMap((a) => a.entries.map((e) => e.date.slice(0, 10))))].sort() : [];

  function entryFor(assignment: EquipmentAssignmentRow, date: string): EquipmentEntry | undefined {
    return assignment.entries.find((en) => en.date.slice(0, 10) === date);
  }

  const daysUsedTotal = timesheet
    ? timesheet.assignments.reduce((sum, a) => sum + a.entries.filter((e) => e.used).length, 0)
    : 0;
  const accruedCost = timesheet
    ? timesheet.assignments.reduce((sum, a) => sum + a.entries.filter((e) => e.used).length * Number(a.dayRate), 0)
    : 0;

  const availableUnits = units.filter((u) => !timesheet?.assignments.some((a) => a.equipmentCode === u.code && a.isActive));

  return (
    <div>
      <div className="card">
        <h2>Project Equipment Timesheet</h2>
        <p style={{ fontSize: 13 }}>
          <Link to={`/projects/${projectId}`}>← Back to project</Link>
        </p>
        <div className="form-row">
          <select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {formatPeriodLabel(p)}
              </option>
            ))}
          </select>
        </div>
        <p style={{ color: "#667085", fontSize: 13 }}>
          Internal-use equipment on this project — vans, buses, and similar — not billed to any customer. Each day
          marked "used" accrues the equipment's day rate into this project's Machinery Cost.
        </p>
        {error && <div className="error-banner">{error}</div>}
      </div>

      {timesheet && (
        <div className="kpi-grid">
          <div className="kpi-tile" style={{ cursor: "default" }}>
            <span className="kpi-label">Equipment assigned</span>
            <span className="kpi-value">{timesheet.assignments.length}</span>
          </div>
          <div className="kpi-tile" style={{ cursor: "default" }}>
            <span className="kpi-label">Days used (period)</span>
            <span className="kpi-value">{daysUsedTotal}</span>
          </div>
          <div className="kpi-tile" style={{ cursor: "default" }}>
            <span className="kpi-label">Accrued machinery cost (period)</span>
            <span className="kpi-value">{money(accruedCost)}</span>
          </div>
        </div>
      )}

      <div className="card">
        <h3>Assign equipment to this project</h3>
        <form onSubmit={assignEquipment} className="form-row">
          <select value={assignForm.equipmentId} onChange={(e) => setAssignForm({ ...assignForm, equipmentId: e.target.value })}>
            <option value="">Select equipment…</option>
            {availableUnits.map((u) => (
              <option key={u.id} value={u.id}>
                {u.code} — {u.name}
                {u.internalDayRate ? ` (day rate ${money(u.internalDayRate)})` : " (no day rate set)"}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={assignForm.startDate}
            onChange={(e) => setAssignForm({ ...assignForm, startDate: e.target.value })}
          />
          <input
            type="number"
            placeholder="Day rate override (optional)"
            style={{ width: 200 }}
            value={assignForm.dayRate}
            onChange={(e) => setAssignForm({ ...assignForm, dayRate: e.target.value })}
          />
          <button type="submit" disabled={busy || !assignForm.equipmentId || !assignForm.startDate}>
            Assign
          </button>
        </form>
        {timesheet && timesheet.assignments.length > 0 && (
          <table style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Equipment</th>
                <th>Day rate</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {timesheet.assignments.map((a) => (
                <tr key={a.assignmentId}>
                  <td>
                    {a.equipmentCode} — {a.equipmentName}
                  </td>
                  <td>{money(a.dayRate)}</td>
                  <td>{a.isActive ? "Active" : "Ended"}</td>
                  <td>
                    {a.isActive && (
                      <button className="secondary" style={{ padding: "2px 8px" }} onClick={() => endAssignment(a.assignmentId)}>
                        End
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="tab-row">
          {TABS.map((t) => (
            <button key={t.id} type="button" className={tab === t.id ? "" : "secondary"} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === "attachments" && timesheet?.periodAttachmentFilename ? " (1)" : ""}
            </button>
          ))}
        </div>

        {tab !== "attachments" && (
          <div className="form-row" style={{ justifyContent: "flex-start" }}>
            <button className="secondary" onClick={manualRefill} disabled={busy}>
              {busy ? "Working…" : "Refill missing days"}
            </button>
          </div>
        )}

        {tab === "overtime" && (
          <p style={{ color: "#667085", fontSize: 13 }}>
            Overtime hours are recorded here for reporting only — they do not change the accrued machinery cost, which
            is always the flat day rate for each day marked used.
          </p>
        )}

        {tab === "attachments" && (
          <div>
            <p style={{ color: "#667085", fontSize: 13 }}>
              One attachment per period — a signed log sheet or gate pass record for this project's equipment.
              Uploading again replaces it.
            </p>
            {!periodId ? (
              <p>Select a period first.</p>
            ) : timesheet?.periodAttachmentFilename ? (
              <div className="form-row" style={{ justifyContent: "flex-start", alignItems: "center" }}>
                <span>{timesheet.periodAttachmentFilename}</span>
                <button className="secondary" onClick={() => setViewingPeriodAttachment(true)}>
                  View
                </button>
                <AttachButton label="Replace" uploading={uploadingPeriodAttachment} onFile={(file) => uploadPeriodAttachment(file)} />
              </div>
            ) : (
              <AttachButton uploading={uploadingPeriodAttachment} onFile={(file) => uploadPeriodAttachment(file)} />
            )}
          </div>
        )}

        {tab === "attachments" ? null : loading ? (
          <p>Loading…</p>
        ) : !timesheet || timesheet.assignments.length === 0 ? (
          <p>No equipment assigned to this project yet.</p>
        ) : dates.length === 0 ? (
          <p>No days in this period yet — click "Refill missing days".</p>
        ) : (
          <div style={{ overflow: "auto", maxHeight: "calc(100vh - 480px)" }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  {timesheet.assignments.map((a) => (
                    <th key={a.assignmentId}>
                      {a.equipmentCode}
                      <span style={{ display: "block", fontWeight: 400, fontSize: 11, color: "#667085" }}>{a.equipmentName}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dates.map((date) => (
                  <tr key={date}>
                    <td>{new Date(date).toLocaleDateString(undefined, { day: "numeric", month: "short", weekday: "short" })}</td>
                    {timesheet.assignments.map((a) => {
                      const entry = entryFor(a, date);
                      if (!entry) return <td key={a.assignmentId}>—</td>;

                      if (tab === "days") {
                        return (
                          <td key={a.assignmentId}>
                            <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <input
                                type="checkbox"
                                checked={entry.used}
                                onChange={(ev) => updateEntry(entry, a.assignmentId, { used: ev.target.checked })}
                              />
                              Used
                            </label>
                            <input
                              type="number"
                              min="0"
                              max="24"
                              step="0.5"
                              style={{ width: 55, marginTop: 4 }}
                              defaultValue={Number(entry.hoursUsed) || ""}
                              onBlur={(ev) => {
                                const v = ev.target.value || "0";
                                if (v !== entry.hoursUsed) updateEntry(entry, a.assignmentId, { hoursUsed: v });
                              }}
                            />
                          </td>
                        );
                      }

                      return (
                        <td key={a.assignmentId}>
                          <input
                            type="number"
                            min="0"
                            max="24"
                            step="0.5"
                            style={{ width: 55 }}
                            defaultValue={Number(entry.overtimeHours) || ""}
                            onBlur={(ev) => {
                              const v = ev.target.value || "0";
                              if (v !== entry.overtimeHours) updateEntry(entry, a.assignmentId, { overtimeHours: v });
                            }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {viewingPeriodAttachment && timesheet?.periodAttachmentFilename && (
        <AttachmentViewer
          filename={timesheet.periodAttachmentFilename}
          fetchBlob={() =>
            apiClient
              .get(`/equipment/projects/${projectId}/period-attachment?fiscalPeriodId=${periodId}`, { responseType: "blob" })
              .then((res) => res.data as Blob)
          }
          onClose={() => setViewingPeriodAttachment(false)}
        />
      )}
    </div>
  );
}
