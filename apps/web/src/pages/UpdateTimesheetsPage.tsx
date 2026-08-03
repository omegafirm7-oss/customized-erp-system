import { Fragment, useCallback, useEffect, useState, type CSSProperties } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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

interface TimesheetEntry {
  id: string;
  date: string;
  dayType: string;
  hoursWorked: string;
  overtimeHours: string;
  attachmentFilename: string | null;
}

interface TimesheetEmployee {
  employeeId: string;
  code: string;
  nameEn: string;
  designation: string | null;
  basicSalary: string;
  entries: TimesheetEntry[];
}

interface TimesheetResponse {
  employees: TimesheetEmployee[];
}

interface PeriodSummary {
  totalPaid: string;
  totalPending: string;
  grandTotal: string;
}

type Tab = "days" | "overtime" | "attachments";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "days", label: "Working days" },
  { id: "overtime", label: "Overtime" },
  { id: "attachments", label: "Attachments" },
];

const DAY_TYPES = [
  { value: "WORKED", label: "W" },
  { value: "REST", label: "R" },
  { value: "ABSENT", label: "A" },
  { value: "UNPAID_LEAVE", label: "U" },
  { value: "ANNUAL_LEAVE", label: "L" },
];

function money(v: string | number): string {
  return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function entryKey(employeeId: string, date: string): string {
  return `${employeeId}|${date}`;
}

// Keeps the Date column visible while scrolling horizontally through many
// employees' columns — otherwise you lose track of which day you're editing.
const STICKY_DATE_COL_STYLE: CSSProperties = {
  position: "sticky",
  left: 0,
  background: "#fff",
  zIndex: 1,
  whiteSpace: "nowrap",
};

// Keeps both header rows (employee code, then Day/Hrs) visible while
// scrolling down a long month of days. `position: sticky` resolves relative
// to the nearest ancestor with a non-"visible" computed overflow on EITHER
// axis — per the CSS overflow spec, setting only `overflowX: auto` still
// forces the used value of overflow-y away from "visible" on that same
// element, silently making the wrapping div itself the sticky-positioning
// ancestor for `top`. Since that div had no bounded height, it never
// actually scrolled, so the header row never stuck — only the Date column's
// `left: 0` appeared to work, because horizontal scroll genuinely happens
// inside that div. Fix: give the wrapper an explicit bounded height with
// `overflow: auto` on both axes, so `top` and `left` stickiness resolve
// against the same real scrollport. The second header row stacks right
// below the first, using its measured height as the offset. zIndex 2 wins
// over the sticky Date column (1) at their shared top-left corner cells.
const GRID_SCROLL_STYLE: CSSProperties = { overflow: "auto", maxHeight: "calc(100vh - 360px)" };
// The Attachments tab deliberately drops the height bound. AttachButton's
// menu is absolutely positioned, and a bounded `overflow: auto` box clips it
// — an unbounded box grows to fit its content instead, so the menu stays
// visible. The trade is that the header no longer sticks on that tab.
const ATTACHMENTS_SCROLL_STYLE: CSSProperties = { overflowX: "auto" };
// px — two lines (code + name) at 8px/10px padding
const HEADER_ROW_HEIGHT = 48;
const STICKY_HEADER_ROW1_STYLE: CSSProperties = { position: "sticky", top: 0, background: "#fff", zIndex: 2 };
const STICKY_HEADER_ROW2_STYLE: CSSProperties = {
  position: "sticky",
  top: HEADER_ROW_HEIGHT,
  background: "#fff",
  zIndex: 2,
};
const STICKY_HEADER_CORNER1_STYLE: CSSProperties = { ...STICKY_DATE_COL_STYLE, ...STICKY_HEADER_ROW1_STYLE };
const STICKY_HEADER_CORNER2_STYLE: CSSProperties = { ...STICKY_DATE_COL_STYLE, ...STICKY_HEADER_ROW2_STYLE };

const EMPLOYEE_NAME_STYLE: CSSProperties = {
  display: "block",
  fontWeight: 400,
  fontSize: 11,
  color: "#667085",
  textTransform: "none",
  letterSpacing: 0,
  maxWidth: 140,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

export function UpdateTimesheetsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [periodId, setPeriodId] = useState("");
  const [tab, setTab] = useState<Tab>("days");
  const [timesheet, setTimesheet] = useState<TimesheetResponse | null>(null);
  const [summary, setSummary] = useState<PeriodSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ entryId: string; filename: string } | null>(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadRaw = useCallback(async (fpId: string) => {
    const [tsRes, summaryRes] = await Promise.all([
      apiClient.get<TimesheetResponse>(`/hr/employee-timesheet?fiscalPeriodId=${fpId}`),
      apiClient.get<PeriodSummary>(`/hr/reports/employees-dashboard?fiscalPeriodId=${fpId}`),
    ]);
    setTimesheet(tsRes.data);
    setSummary(summaryRes.data);
  }, []);

  // Prefill is idempotent (only fills missing days) so running it every time
  // the period is opened guarantees the grid is always fully populated —
  // no blank, unfillable "—" cells left over from a period never prefilled.
  useEffect(() => {
    if (!periodId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setDirtyKeys(new Set());
      try {
        await apiClient.post("/hr/employee-timesheet/prefill", { fiscalPeriodId: periodId });
        if (cancelled) return;
        await loadRaw(periodId);
      } catch (err: any) {
        if (!cancelled) setError(err?.response?.data?.message ?? "Failed to load timesheet");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [periodId, loadRaw]);

  async function manualRefill() {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post("/hr/employee-timesheet/prefill", { fiscalPeriodId: periodId });
      await loadRaw(periodId);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Refill failed");
    } finally {
      setBusy(false);
    }
  }

  async function resetHours() {
    if (
      !window.confirm(
        "Reset every hour in this period back to 0? Day types (W/R/A/U/L) are kept — only worked hours and overtime hours are cleared.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiClient.post("/hr/employee-timesheet/reset-hours", { fiscalPeriodId: periodId });
      setDirtyKeys(new Set());
      await loadRaw(periodId);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  function patchLocal(employeeId: string, date: string, patch: Partial<TimesheetEntry>) {
    setTimesheet((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        employees: prev.employees.map((e) =>
          e.employeeId !== employeeId
            ? e
            : { ...e, entries: e.entries.map((en) => (en.date.slice(0, 10) !== date ? en : { ...en, ...patch })) },
        ),
      };
    });
    setDirtyKeys((prev) => new Set(prev).add(entryKey(employeeId, date)));
  }

  // Saves one cell to the server; clears its dirty flag on success so the
  // "Save changes" button and Back-to-Overview flush only retry what's
  // actually still unsaved.
  async function saveEntry(
    employeeId: string,
    date: string,
    dayType: string,
    hoursWorked: string,
    overtimeHours: string,
  ): Promise<boolean> {
    try {
      await apiClient.post("/hr/employee-timesheet/entry", { employeeId, date, dayType, hoursWorked, overtimeHours });
      setDirtyKeys((prev) => {
        const next = new Set(prev);
        next.delete(entryKey(employeeId, date));
        return next;
      });
      return true;
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to save one or more changes");
      return false;
    }
  }

  // Optimistic: the grid updates immediately from local state; the save
  // happens right after in the background — no full-page reload/flash.
  async function updateEntry(
    employeeId: string,
    date: string,
    patch: { dayType?: string; hoursWorked?: string; overtimeHours?: string },
  ) {
    const employee = timesheet?.employees.find((e) => e.employeeId === employeeId);
    const entry = employee?.entries.find((e) => e.date.slice(0, 10) === date);
    const dayType = patch.dayType ?? entry?.dayType ?? "WORKED";
    // A day-type click resets hours (W = standard 10-hour day, everything
    // else 0). An edit on any OTHER tab must leave hours alone — this used
    // to recompute them unconditionally, which would have silently reset a
    // day to 10h just for typing an overtime figure.
    const hoursWorked =
      patch.hoursWorked ?? (patch.dayType !== undefined ? (dayType === "WORKED" ? "10" : "0") : (entry?.hoursWorked ?? "0"));
    // Overtime survives a day-type click on a worked day, but a day that is
    // no longer worked can't carry overtime.
    const overtimeHours =
      patch.overtimeHours ?? (patch.dayType !== undefined && dayType !== "WORKED" ? "0" : (entry?.overtimeHours ?? "0"));
    patchLocal(employeeId, date, { dayType, hoursWorked, overtimeHours });
    setError(null);
    const ok = await saveEntry(employeeId, date, dayType, hoursWorked, overtimeHours);
    if (ok) {
      const summaryRes = await apiClient.get<PeriodSummary>(`/hr/reports/employees-dashboard?fiscalPeriodId=${periodId}`);
      setSummary(summaryRes.data);
    }
  }

  // Explicit save action + safety net: flushes anything still marked dirty
  // (e.g. a value typed but never blurred) rather than relying purely on
  // per-field auto-save timing.
  async function saveAllDirty() {
    if (dirtyKeys.size === 0 || !timesheet) return;
    setBusy(true);
    setError(null);
    for (const key of [...dirtyKeys]) {
      const [employeeId, date] = key.split("|");
      const employee = timesheet.employees.find((e) => e.employeeId === employeeId);
      const entry = employee?.entries.find((en) => en.date.slice(0, 10) === date);
      if (entry) {
        await saveEntry(employeeId, date, entry.dayType, entry.hoursWorked, entry.overtimeHours);
      }
    }
    const summaryRes = await apiClient.get<PeriodSummary>(`/hr/reports/employees-dashboard?fiscalPeriodId=${periodId}`);
    setSummary(summaryRes.data);
    setBusy(false);
  }

  async function goBackToOverview() {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    await saveAllDirty();
    navigate("/hr/employees/overview");
  }

  async function uploadAttachment(entryId: string, file: File) {
    setError(null);
    setUploadingFor(entryId);
    try {
      const form = new FormData();
      form.append("file", file);
      await apiClient.post(`/hr/employee-timesheet/entries/${entryId}/attachment`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      await loadRaw(periodId);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Upload failed");
    } finally {
      setUploadingFor(null);
    }
  }

  // Optional deep-link filter to just one employee's columns — makes the
  // "Timesheets" button on Employee Detail actually useful for a large
  // roster instead of always landing on the full multi-employee grid.
  const filterEmployeeId = searchParams.get("employee");
  const visibleEmployees = timesheet
    ? filterEmployeeId
      ? timesheet.employees.filter((e) => e.employeeId === filterEmployeeId)
      : timesheet.employees
    : [];

  const dates = timesheet
    ? [...new Set(visibleEmployees.flatMap((e) => e.entries.map((en) => en.date.slice(0, 10))))].sort()
    : [];

  const hoursPosted = visibleEmployees.reduce(
    (sum, e) => sum + e.entries.reduce((s, en) => s + Number(en.hoursWorked), 0),
    0,
  );
  const overtimePosted = visibleEmployees.reduce(
    (sum, e) => sum + e.entries.reduce((s, en) => s + Number(en.overtimeHours), 0),
    0,
  );
  const attachmentCount = visibleEmployees.reduce(
    (sum, e) => sum + e.entries.filter((en) => en.attachmentFilename).length,
    0,
  );

  function entryFor(employee: TimesheetEmployee, date: string): TimesheetEntry | undefined {
    return employee.entries.find((en) => en.date.slice(0, 10) === date);
  }

  const columnsPerEmployee = tab === "days" ? 2 : 1;

  return (
    <div>
      <div className="card">
        <h2>Update Timesheets</h2>
        <div className="form-row">
          <button className="secondary" onClick={goBackToOverview} disabled={busy}>
            {busy ? "Saving…" : "Back to Overview"}
          </button>
          <select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {formatPeriodLabel(p)}
              </option>
            ))}
          </select>
        </div>
        <p style={{ color: "#667085", fontSize: 13 }}>
          W = worked · R = rest · A = absent · U = unpaid leave · L = annual leave. Click a day-type button to set it —
          W sets the standard 10-hour day, R/A/U/L zero the hours; the Hrs field is still editable afterwards for a
          non-standard day. Changes save immediately in the background, and "Back to Overview" always flushes
          anything still pending first. To backfill history, open each period from project start to now once.
        </p>
        {error && <div className="error-banner">{error}</div>}
      </div>

      {summary && (
        <div className="kpi-grid">
          <div className="kpi-tile" style={{ cursor: "default" }}>
            <span className="kpi-label">Hours posted (period)</span>
            <span className="kpi-value">{hoursPosted}</span>
          </div>
          <div className="kpi-tile" style={{ cursor: "default" }}>
            <span className="kpi-label">Overtime hours (period)</span>
            <span className="kpi-value">{overtimePosted}</span>
          </div>
          <div className="kpi-tile" style={{ cursor: "default" }}>
            <span className="kpi-label">Employees this period</span>
            <span className="kpi-value">{visibleEmployees.length}</span>
          </div>
          <div className="kpi-tile" style={{ cursor: "default" }}>
            <span className="kpi-label">Accrued labor cost (period)</span>
            <span className="kpi-value">{money(summary.grandTotal)}</span>
          </div>
          <div className="kpi-tile" style={{ cursor: "default" }}>
            <span className="kpi-label">Paid this period</span>
            <span className="kpi-value">{money(summary.totalPaid)}</span>
          </div>
        </div>
      )}

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

        <div className="form-row" style={{ justifyContent: "flex-start" }}>
          <button className="secondary" onClick={manualRefill} disabled={busy}>
            {busy ? "Working…" : "Refill missing days"}
          </button>
          <button className="secondary" onClick={resetHours} disabled={busy}>
            {busy ? "Working…" : "Reset hours to zero"}
          </button>
          <button onClick={saveAllDirty} disabled={busy || dirtyKeys.size === 0}>
            {dirtyKeys.size > 0 ? `Save changes (${dirtyKeys.size})` : "All changes saved"}
          </button>
        </div>

        {tab === "overtime" && (
          <p style={{ color: "#667085", fontSize: 13 }}>
            Overtime hours are recorded here for reporting only — they do not change payroll or the accrued labor cost.
            Overtime is still paid through the payroll run, where you enter it as you do today.
          </p>
        )}
        {tab === "attachments" && (
          <p style={{ color: "#667085", fontSize: 13 }}>
            Attach evidence to a single day — a signed site sheet, a gate pass, a photo. One file per employee per day;
            attach again to replace it.
          </p>
        )}

        {filterEmployeeId && (
          <p style={{ fontSize: 13 }}>
            Showing one employee only —{" "}
            <button
              className="secondary"
              style={{ padding: "2px 8px" }}
              onClick={() => navigate(periodId ? `/hr/employees/timesheets?period=${periodId}` : "/hr/employees/timesheets")}
            >
              show all employees
            </button>
          </p>
        )}

        {loading ? (
          <p>Loading…</p>
        ) : !timesheet || visibleEmployees.length === 0 ? (
          <p>No active employees.</p>
        ) : dates.length === 0 ? (
          <p>No days in this period yet.</p>
        ) : (
          <div style={tab === "attachments" ? ATTACHMENTS_SCROLL_STYLE : GRID_SCROLL_STYLE}>
            <table>
              <thead>
                <tr>
                  <th style={STICKY_HEADER_CORNER1_STYLE}>Date</th>
                  {visibleEmployees.map((e) => (
                    <th key={e.employeeId} colSpan={columnsPerEmployee} style={STICKY_HEADER_ROW1_STYLE}>
                      {e.code}
                      <span style={EMPLOYEE_NAME_STYLE} title={e.designation ? `${e.nameEn} — ${e.designation}` : e.nameEn}>
                        {e.nameEn}
                      </span>
                    </th>
                  ))}
                </tr>
                <tr>
                  <th style={STICKY_HEADER_CORNER2_STYLE}></th>
                  {visibleEmployees.map((e) =>
                    tab === "days" ? (
                      <Fragment key={e.employeeId}>
                        <th style={STICKY_HEADER_ROW2_STYLE}>Day</th>
                        <th style={STICKY_HEADER_ROW2_STYLE}>Hrs</th>
                      </Fragment>
                    ) : (
                      <th key={e.employeeId} style={STICKY_HEADER_ROW2_STYLE}>
                        {tab === "overtime" ? "OT hrs" : "File"}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {dates.map((date) => (
                  <tr key={date}>
                    <td style={STICKY_DATE_COL_STYLE}>
                      {new Date(date).toLocaleDateString(undefined, { day: "numeric", month: "short", weekday: "short" })}
                    </td>
                    {visibleEmployees.map((e) => {
                      const entry = entryFor(e, date);
                      if (!entry) {
                        return tab === "days" ? (
                          <Fragment key={e.employeeId}>
                            <td>—</td>
                            <td>—</td>
                          </Fragment>
                        ) : (
                          <td key={e.employeeId}>—</td>
                        );
                      }
                      const dirty = dirtyKeys.has(entryKey(e.employeeId, date));
                      const dirtyStyle = dirty ? { background: "#fff8e1" } : undefined;

                      if (tab === "days") {
                        return (
                          <Fragment key={e.employeeId}>
                            <td style={dirtyStyle}>
                              <div style={{ display: "flex", gap: 2 }}>
                                {DAY_TYPES.map((dt) => (
                                  <button
                                    key={dt.value}
                                    type="button"
                                    className={entry.dayType === dt.value ? "" : "secondary"}
                                    style={{ padding: "2px 5px", minWidth: 22, fontSize: 12 }}
                                    title={dt.value}
                                    // Always fires, even re-clicking the already-active day
                                    // type — unlike a native <select>, which silently drops
                                    // onChange when the reselected option is unchanged. That
                                    // was why clicking W on an already-W day never set 10h.
                                    onClick={() => updateEntry(e.employeeId, date, { dayType: dt.value })}
                                  >
                                    {dt.label}
                                  </button>
                                ))}
                              </div>
                            </td>
                            <td style={dirtyStyle}>
                              <input
                                type="number"
                                min="0"
                                max="24"
                                step="0.5"
                                style={{ width: 55 }}
                                value={Number(entry.hoursWorked)}
                                onChange={(ev) => patchLocal(e.employeeId, date, { hoursWorked: ev.target.value })}
                                onBlur={(ev) => {
                                  const v = ev.target.value || "0";
                                  if (v !== entry.hoursWorked) updateEntry(e.employeeId, date, { hoursWorked: v });
                                }}
                              />
                            </td>
                          </Fragment>
                        );
                      }

                      if (tab === "overtime") {
                        const worked = entry.dayType === "WORKED";
                        return (
                          <td key={e.employeeId} style={dirtyStyle}>
                            <input
                              type="number"
                              min="0"
                              max="24"
                              step="0.5"
                              style={{ width: 55 }}
                              // A non-worked day can't carry overtime — the server
                              // zeroes it there, so don't offer an input that lies.
                              disabled={!worked}
                              title={worked ? undefined : `Day is ${entry.dayType.toLowerCase().replace("_", " ")}`}
                              value={Number(entry.overtimeHours)}
                              onChange={(ev) => patchLocal(e.employeeId, date, { overtimeHours: ev.target.value })}
                              onBlur={(ev) => {
                                const v = ev.target.value || "0";
                                if (v !== entry.overtimeHours) updateEntry(e.employeeId, date, { overtimeHours: v });
                              }}
                            />
                          </td>
                        );
                      }

                      return (
                        <td key={e.employeeId}>
                          {entry.attachmentFilename ? (
                            <button
                              className="secondary"
                              style={{ padding: "2px 8px", fontSize: 12 }}
                              onClick={() => setViewer({ entryId: entry.id, filename: entry.attachmentFilename! })}
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
        )}
      </div>

      {viewer && (
        <AttachmentViewer
          filename={viewer.filename}
          fetchBlob={() =>
            apiClient
              .get(`/hr/employee-timesheet/entries/${viewer.entryId}/attachment`, { responseType: "blob" })
              .then((res) => res.data as Blob)
          }
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}
