import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiClient } from "../api/client";

interface FiscalPeriod {
  id: string;
  periodNumber: number;
  startDate: string;
  endDate: string;
}

interface TimesheetEntry {
  date: string;
  dayType: string;
  hoursWorked: string;
}

interface TimesheetEmployee {
  employeeId: string;
  code: string;
  nameEn: string;
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
// scrolling down a long month of days — the page scrolls at the document
// level (no inner scroll container), so `position: sticky; top: <n>`
// sticks relative to the viewport itself. The second row stacks right
// below the first, using its measured height as the offset. zIndex 2 wins
// over the sticky Date column (1) at their shared top-left corner cells.
const HEADER_ROW_HEIGHT = 33; // px — matches th padding (8px 10px) + 11px uppercase label
const STICKY_HEADER_ROW1_STYLE: CSSProperties = { position: "sticky", top: 0, background: "#fff", zIndex: 2 };
const STICKY_HEADER_ROW2_STYLE: CSSProperties = {
  position: "sticky",
  top: HEADER_ROW_HEIGHT,
  background: "#fff",
  zIndex: 2,
};
const STICKY_HEADER_CORNER1_STYLE: CSSProperties = { ...STICKY_DATE_COL_STYLE, ...STICKY_HEADER_ROW1_STYLE };
const STICKY_HEADER_CORNER2_STYLE: CSSProperties = { ...STICKY_DATE_COL_STYLE, ...STICKY_HEADER_ROW2_STYLE };

export function UpdateTimesheetsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [periodId, setPeriodId] = useState("");
  const [timesheet, setTimesheet] = useState<TimesheetResponse | null>(null);
  const [summary, setSummary] = useState<PeriodSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());

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
    if (!window.confirm("Reset every hour in this period back to 0? Day types (W/R/A/U/L) are kept — only the hours are cleared.")) {
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
  async function saveEntry(employeeId: string, date: string, dayType: string, hoursWorked: string): Promise<boolean> {
    try {
      await apiClient.post("/hr/employee-timesheet/entry", { employeeId, date, dayType, hoursWorked });
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
  async function updateEntry(employeeId: string, date: string, patch: { dayType?: string; hoursWorked?: string }) {
    const employee = timesheet?.employees.find((e) => e.employeeId === employeeId);
    const entry = employee?.entries.find((e) => e.date.slice(0, 10) === date);
    const dayType = patch.dayType ?? entry?.dayType ?? "WORKED";
    // Switching to WORKED assumes the standard 10-hour day (still fully
    // editable afterwards); switching to anything else always zeroes
    // hours — neither is ever carried over from the previous dayType,
    // unless this same call explicitly set new hours (the Hrs input).
    const hoursWorked = patch.hoursWorked ?? (dayType === "WORKED" ? "10" : "0");
    patchLocal(employeeId, date, { dayType, hoursWorked });
    setError(null);
    const ok = await saveEntry(employeeId, date, dayType, hoursWorked);
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
        await saveEntry(employeeId, date, entry.dayType, entry.hoursWorked);
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

  // Optional deep-link filter to just one employee's two columns — makes
  // the "Timesheets" button on Employee Detail actually useful for a large
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

  const hoursPosted = timesheet
    ? visibleEmployees.reduce((sum, e) => sum + e.entries.reduce((s, en) => s + Number(en.hoursWorked), 0), 0)
    : 0;

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
                Period {p.periodNumber} ({new Date(p.startDate).toLocaleDateString()} – {new Date(p.endDate).toLocaleDateString()})
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
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th style={STICKY_HEADER_CORNER1_STYLE}>Date</th>
                  {visibleEmployees.map((e) => (
                    <th key={e.employeeId} colSpan={2} style={STICKY_HEADER_ROW1_STYLE}>
                      {e.code}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th style={STICKY_HEADER_CORNER2_STYLE}></th>
                  {visibleEmployees.map((e) => (
                    <>
                      <th key={`${e.employeeId}-d`} style={STICKY_HEADER_ROW2_STYLE}>Day</th>
                      <th key={`${e.employeeId}-h`} style={STICKY_HEADER_ROW2_STYLE}>Hrs</th>
                    </>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dates.map((date) => (
                  <tr key={date}>
                    <td style={STICKY_DATE_COL_STYLE}>
                      {new Date(date).toLocaleDateString(undefined, { day: "numeric", month: "short", weekday: "short" })}
                    </td>
                    {visibleEmployees.map((e) => {
                      const entry = e.entries.find((en) => en.date.slice(0, 10) === date);
                      if (!entry) {
                        return (
                          <>
                            <td key={`${e.employeeId}-d`}>—</td>
                            <td key={`${e.employeeId}-h`}>—</td>
                          </>
                        );
                      }
                      const dirty = dirtyKeys.has(entryKey(e.employeeId, date));
                      return (
                        <>
                          <td key={`${e.employeeId}-d`} style={dirty ? { background: "#fff8e1" } : undefined}>
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
                          <td key={`${e.employeeId}-h`} style={dirty ? { background: "#fff8e1" } : undefined}>
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
                        </>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
