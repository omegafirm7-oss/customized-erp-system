import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiClient } from "../api/client";

interface FiscalPeriod {
  id: string;
  periodNumber: number;
  startDate: string;
  endDate: string;
}

interface TimesheetEntryRow {
  date: string;
  dayType: string;
  hoursWorked: string;
}

interface ActiveEmployeeRow {
  employeeId: string;
  code: string;
  nameEn: string;
  designation: string | null;
  costCenter: { code: string; name: string } | null;
  basicSalary: string;
  hourlyRate: string;
  daysWorked: number;
  totalHours: string;
  cost: string;
  allowancesPaid: string;
  pendingAdvances: string;
  timesheetEntries: TimesheetEntryRow[];
}

function money(v: string | number): string {
  return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ActiveEmployeesDetailPage() {
  const navigate = useNavigate();
  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [periodId, setPeriodId] = useState("");
  const [scope, setScope] = useState<"overall" | "period">("overall");
  const [rows, setRows] = useState<ActiveEmployeeRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiClient.get<FiscalPeriod[]>("/companies/current/fiscal-periods").then((res) => {
      const list = res.data;
      setPeriods(list);
      const now = Date.now();
      const current = list.find((p) => new Date(p.startDate).getTime() <= now && now <= new Date(p.endDate).getTime());
      setPeriodId(current?.id ?? list[0]?.id ?? "");
    });
  }, []);

  const load = useCallback(async (currentScope: "overall" | "period", fpId: string) => {
    if (currentScope === "period" && !fpId) return;
    setLoading(true);
    try {
      const query = currentScope === "period" ? `?fiscalPeriodId=${fpId}` : "";
      const res = await apiClient.get<ActiveEmployeeRow[]>(`/hr/reports/active-employees-detail${query}`);
      setRows(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(scope, periodId);
  }, [scope, periodId, load]);

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>Active Employees — Detail</h2>
          <button className="secondary" onClick={() => navigate("/hr/employees/overview")}>
            Back to Overview
          </button>
        </div>
        <div className="form-row" style={{ marginTop: 10 }}>
          <button className={scope === "overall" ? "" : "secondary"} onClick={() => setScope("overall")}>
            Overall
          </button>
          <button className={scope === "period" ? "" : "secondary"} onClick={() => setScope("period")}>
            This period
          </button>
          {scope === "period" && (
            <select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  Period {p.periodNumber} ({new Date(p.startDate).toLocaleDateString()} – {new Date(p.endDate).toLocaleDateString()})
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="card">
        {loading ? (
          <p>Loading…</p>
        ) : rows.length === 0 ? (
          <p>No active employees.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Cost center</th>
                  <th>Basic salary</th>
                  <th>Hourly rate</th>
                  <th>Days worked</th>
                  <th>Hours</th>
                  <th>Cost</th>
                  <th>Allowances paid</th>
                  <th>Pending advances</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <>
                    <tr key={row.employeeId}>
                      <td>
                        <Link to={`/hr/employees/${row.employeeId}`}>{row.code}</Link>
                      </td>
                      <td>{row.nameEn}</td>
                      <td>{row.costCenter?.code ?? "—"}</td>
                      <td>{money(row.basicSalary)}</td>
                      <td>{money(row.hourlyRate)}</td>
                      <td>{row.daysWorked}</td>
                      <td>{Number(row.totalHours)}</td>
                      <td>{money(row.cost)}</td>
                      <td>{Number(row.allowancesPaid) > 0 ? money(row.allowancesPaid) : "—"}</td>
                      <td>{Number(row.pendingAdvances) > 0 ? money(row.pendingAdvances) : "—"}</td>
                      <td>
                        <button className="secondary" onClick={() => setExpanded(expanded === row.employeeId ? null : row.employeeId)}>
                          {expanded === row.employeeId ? "Hide" : "Entries"}
                        </button>
                      </td>
                    </tr>
                    {expanded === row.employeeId && (
                      <tr>
                        <td colSpan={11}>
                          {row.timesheetEntries.length === 0 ? (
                            <p style={{ margin: "6px 0" }}>No timesheet entries.</p>
                          ) : (
                            <table style={{ margin: "6px 0" }}>
                              <thead>
                                <tr>
                                  <th>Date</th>
                                  <th>Day type</th>
                                  <th>Hours</th>
                                </tr>
                              </thead>
                              <tbody>
                                {row.timesheetEntries.map((entry) => (
                                  <tr key={entry.date}>
                                    <td>{new Date(entry.date).toLocaleDateString(undefined, { day: "numeric", month: "short", weekday: "short" })}</td>
                                    <td>{entry.dayType}</td>
                                    <td>{Number(entry.hoursWorked)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
