import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../api/client";

interface FiscalPeriod {
  id: string;
  periodNumber: number;
  startDate: string;
  endDate: string;
  status: string;
}

interface DashboardRow {
  employeeId: string;
  code: string;
  nameEn: string;
  designation: string | null;
  basicSalary: string;
  hourlyRate: string;
  hoursWorked: string;
  cost: string;
}

interface DashboardGroup {
  key: string;
  label: string;
  rows: DashboardRow[];
  subtotal: string;
}

interface DashboardResponse {
  scope: "overall" | "period";
  activeCount: number;
  releasedCount: number;
  totalPaid: string;
  totalPaidActive: string;
  totalPaidReleased: string;
  totalPending: string;
  totalPendingActive: string;
  totalPendingReleased: string;
  totalPendingAdvances: string;
  totalPendingSettlements: string;
  pendingLaborAccrual: string;
  dailyLaborCost: Array<{ date: string; cost: string }>;
  groups: DashboardGroup[];
  grandTotal: string;
}

function money(v: string | number): string {
  return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function DailyCostChart({ data }: { data: Array<{ date: string; cost: string }> }) {
  if (data.length === 0) {
    return <p style={{ color: "#667085", fontSize: 13 }}>No timesheet cost data yet — open Update Timesheets to fill in hours.</p>;
  }
  const max = Math.max(...data.map((d) => Number(d.cost)), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 140, overflowX: "auto", padding: "8px 2px" }}>
      {data.map((d) => {
        const pct = Math.max((Number(d.cost) / max) * 100, 2);
        return (
          <div
            key={d.date}
            title={`${new Date(d.date).toLocaleDateString(undefined, { day: "numeric", month: "short" })}: SAR ${money(d.cost)}`}
            style={{ flex: "0 0 auto", width: 9, height: "100%", display: "flex", alignItems: "flex-end" }}
          >
            <div style={{ width: "100%", height: `${pct}%`, background: "#1e4fa3", borderRadius: "3px 3px 0 0" }} />
          </div>
        );
      })}
    </div>
  );
}

export function EmployeesOverviewPage() {
  const navigate = useNavigate();
  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [periodId, setPeriodId] = useState("");
  const [scope, setScope] = useState<"overall" | "period">("overall");
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPendingBreakdown, setShowPendingBreakdown] = useState(false);
  const [showPaidBreakdown, setShowPaidBreakdown] = useState(false);

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
    setError(null);
    try {
      const query = currentScope === "period" ? `?fiscalPeriodId=${fpId}` : "";
      const res = await apiClient.get<DashboardResponse>(`/hr/reports/employees-dashboard${query}`);
      setDashboard(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to load overview");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(scope, periodId);
  }, [scope, periodId, load]);

  const dailyCostCaption =
    scope === "overall"
      ? "Every day recorded to date, across all periods."
      : "Days within the selected period only.";

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>Employees Overview</h2>
          <span>
            <button
              className="secondary"
              onClick={() =>
                navigate(
                  scope === "period" && periodId
                    ? `/hr/employees/timesheets?period=${periodId}`
                    : "/hr/employees/timesheets",
                )
              }
            >
              Update Timesheets
            </button>
          </span>
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
        {error && <div className="error-banner">{error}</div>}
      </div>

      {loading || !dashboard ? (
        <div className="card">
          <p>Loading…</p>
        </div>
      ) : (
        <>
          <div className="kpi-grid">
            <button className="kpi-tile" onClick={() => navigate("/hr/employees/overview/active")}>
              <span className="kpi-label">Active employees</span>
              <span className="kpi-value">{dashboard.activeCount}</span>
            </button>
            <button className="kpi-tile" onClick={() => navigate("/hr/employees/overview/released")}>
              <span className="kpi-label">Released employees</span>
              <span className="kpi-value">{dashboard.releasedCount}</span>
            </button>
            <button className="kpi-tile" onClick={() => setShowPaidBreakdown((v) => !v)}>
              <span className="kpi-label">Total paid {scope === "overall" ? "(overall)" : "(period)"}</span>
              <span className="kpi-value">{money(dashboard.totalPaid)}</span>
            </button>
            <button className="kpi-tile" onClick={() => setShowPendingBreakdown((v) => !v)}>
              <span className="kpi-label">Total pending</span>
              <span className="kpi-value">{money(dashboard.totalPending)}</span>
            </button>
          </div>
          {showPaidBreakdown && (
            <div className="card" style={{ marginTop: -10 }}>
              <div className="form-row" style={{ justifyContent: "space-between" }}>
                <span>
                  Paid — active employees (payroll + allowances/advances) —{" "}
                  <a onClick={() => navigate("/hr/employees/overview/active")} style={{ cursor: "pointer" }}>view active employees</a>
                </span>
                <strong>{money(dashboard.totalPaidActive)}</strong>
              </div>
              <div className="form-row" style={{ justifyContent: "space-between" }}>
                <span>
                  Paid — released employees (settlement payouts) —{" "}
                  <a onClick={() => navigate("/hr/employees/overview/released")} style={{ cursor: "pointer" }}>view released employees</a>
                </span>
                <strong>{money(dashboard.totalPaidReleased)}</strong>
              </div>
            </div>
          )}
          {showPendingBreakdown && (
            <div className="card" style={{ marginTop: -10 }}>
              <div className="form-row" style={{ justifyContent: "space-between" }}>
                <span>
                  Pending — active employees (advances + unpaid logged hours) —{" "}
                  <a onClick={() => navigate("/hr/employees/overview/active")} style={{ cursor: "pointer" }}>view active employees</a>
                </span>
                <strong>{money(dashboard.totalPendingActive)}</strong>
              </div>
              <div className="form-row" style={{ justifyContent: "space-between", paddingLeft: 20, fontSize: 13, color: "#667085" }}>
                <span>— of which advances pending</span>
                <span>{money(dashboard.totalPendingAdvances)}</span>
              </div>
              <div className="form-row" style={{ justifyContent: "space-between", paddingLeft: 20, fontSize: 13, color: "#667085" }}>
                <span>— of which unpaid labor cost (from timesheets, not yet covered by payroll)</span>
                <span>{money(dashboard.pendingLaborAccrual)}</span>
              </div>
              <div className="form-row" style={{ justifyContent: "space-between" }}>
                <span>
                  Pending — released employees (settlement payouts) —{" "}
                  <a onClick={() => navigate("/hr/employees/overview/released")} style={{ cursor: "pointer" }}>view released employees</a>
                </span>
                <strong>{money(dashboard.totalPendingReleased)}</strong>
              </div>
            </div>
          )}

          <div className="card">
            <h3>Daily labor cost</h3>
            <p style={{ color: "#667085", fontSize: 13 }}>
              Hourly rate = basic salary ÷ 26 working days ÷ 10-hour standard day. Cost per day = Σ hours worked ×
              hourly rate across all active employees, from real timesheets. {dailyCostCaption}
            </p>
            <DailyCostChart data={dashboard.dailyLaborCost} />
          </div>

          <div className="card">
            <h3>Cost by project</h3>
            {dashboard.groups.length === 0 ? (
              <p>No active employees.</p>
            ) : (
              <>
                {dashboard.groups.map((group) => (
                  <div key={group.key} style={{ marginBottom: 16 }}>
                    <h4>{group.label}</h4>
                    <table>
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>Name</th>
                          <th>Basic salary</th>
                          <th>Hourly rate</th>
                          <th>Hours</th>
                          <th>Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((row) => (
                          <tr key={row.employeeId}>
                            <td>{row.code}</td>
                            <td>{row.nameEn}</td>
                            <td>{money(row.basicSalary)}</td>
                            <td>{money(row.hourlyRate)}</td>
                            <td>{Number(row.hoursWorked)}</td>
                            <td>{money(row.cost)}</td>
                          </tr>
                        ))}
                        <tr style={{ fontWeight: 600 }}>
                          <td colSpan={5}>Subtotal</td>
                          <td>{money(group.subtotal)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ))}
                <p style={{ fontWeight: 600 }}>Grand total: {money(dashboard.grandTotal)}</p>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
