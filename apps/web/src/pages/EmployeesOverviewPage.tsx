import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../api/client";
import { downloadCsv } from "../utils/csv";
import { downloadPdf } from "../utils/pdf";

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
  paidSalary: string;
  paidAllowance: string;
  paidFood: string;
  paidAdvance: string;
  totalPending: string;
  totalPendingActive: string;
  totalPendingReleased: string;
  totalPendingAdvances: string;
  pendingLaborAccrual: string;
  dailyLaborCost: Array<{ date: string; cost: string }>;
  groups: DashboardGroup[];
  grandTotal: string;
  releasedGrandTotal: string;
  releasedTradeRows: Array<{ employeeId: string; code: string; nameEn: string; designation: string | null; cost: string }>;
}

interface LaborCostByDateRangeResponse {
  fromDate: string;
  toDate: string;
  trades: string[];
  totalCost: string;
  totalHours: string;
  employeeCount: number;
  breakdown: Array<{ trade: string; cost: string; hours: string; employeeCount: number }>;
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

interface TradeRow {
  trade: string;
  headcount: number;
  cost: number;
}

function TradeBarChart({ data }: { data: TradeRow[] }) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.cost), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {data.map((d) => (
        <div key={d.trade} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 160, fontSize: 13, color: "#344054", textAlign: "right", flexShrink: 0 }}>{d.trade}</div>
          <div style={{ flex: 1, background: "#f2f4f7", borderRadius: 4, overflow: "hidden", height: 20 }}>
            <div
              style={{
                width: `${Math.max((d.cost / max) * 100, 2)}%`,
                height: "100%",
                background: "#1e4fa3",
                borderRadius: 4,
              }}
            />
          </div>
          <div style={{ width: 110, fontSize: 13, fontWeight: 600, flexShrink: 0 }}>{money(d.cost)}</div>
          <div style={{ width: 70, fontSize: 12, color: "#667085", flexShrink: 0 }}>{d.headcount} emp.</div>
        </div>
      ))}
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

  const allRows = useMemo(() => dashboard?.groups.flatMap((g) => g.rows) ?? [], [dashboard]);

  const [tradeScope, setTradeScope] = useState<"active" | "all">("active");

  const tradeBreakdown = useMemo<TradeRow[]>(() => {
    const byTrade = new Map<string, TradeRow>();
    for (const row of allRows) {
      const trade = row.designation?.trim() || "Unspecified";
      const existing = byTrade.get(trade);
      if (existing) {
        existing.headcount += 1;
        existing.cost += Number(row.cost);
      } else {
        byTrade.set(trade, { trade, headcount: 1, cost: Number(row.cost) });
      }
    }
    if (tradeScope === "all") {
      for (const row of dashboard?.releasedTradeRows ?? []) {
        const trade = row.designation?.trim() || "Unspecified";
        const existing = byTrade.get(trade);
        if (existing) {
          existing.headcount += 1;
          existing.cost += Number(row.cost);
        } else {
          byTrade.set(trade, { trade, headcount: 1, cost: Number(row.cost) });
        }
      }
    }
    return [...byTrade.values()].sort((a, b) => b.cost - a.cost);
  }, [allRows, dashboard, tradeScope]);

  function downloadTradeBreakdown() {
    downloadCsv(
      `employees-by-trade-${scope}${scope === "period" ? `-${periodId}` : ""}.csv`,
      ["Trade", "Headcount", "Total cost (SAR)"],
      tradeBreakdown.map((t) => [t.trade, t.headcount, t.cost.toFixed(2)]),
    );
  }

  function downloadEmployeeCostReport() {
    downloadCsv(
      `employee-cost-report-${scope}${scope === "period" ? `-${periodId}` : ""}.csv`,
      ["Employee code", "Name", "Trade", "Cost center", "Basic salary", "Hourly rate", "Hours worked", "Cost (SAR)"],
      (dashboard?.groups ?? []).flatMap((g) =>
        g.rows.map((r) => [
          r.code,
          r.nameEn,
          r.designation?.trim() || "Unspecified",
          g.label,
          Number(r.basicSalary).toFixed(2),
          Number(r.hourlyRate).toFixed(2),
          Number(r.hoursWorked),
          Number(r.cost).toFixed(2),
        ]),
      ),
    );
  }

  function downloadTradeBreakdownPdf() {
    const totalCost = tradeBreakdown.reduce((sum, t) => sum + t.cost, 0);
    downloadPdf(
      `employees-by-trade-${scope}${scope === "period" ? `-${periodId}` : ""}.pdf`,
      "Employees by Trade",
      [
        {
          kpis: [{ label: "Grand total", value: totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }],
        },
        {
          headers: ["Trade", "Headcount", "Cost (SAR)", "% of total"],
          rows: tradeBreakdown.map((t) => [
            t.trade,
            t.headcount,
            t.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            totalCost > 0 ? `${((t.cost / totalCost) * 100).toFixed(1)}%` : "0.0%",
          ]),
        },
      ],
    );
  }

  // All trades ever seen (active + released), independent of the
  // Overall/This-period toggle above — this date-range tool searches
  // across whatever range the user picks, not the dashboard's own scope.
  const tradeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of allRows) set.add(row.designation?.trim() || "Unspecified");
    for (const row of dashboard?.releasedTradeRows ?? []) set.add(row.designation?.trim() || "Unspecified");
    return [...set].sort();
  }, [allRows, dashboard]);

  const [rangeFromDate, setRangeFromDate] = useState("");
  const [rangeToDate, setRangeToDate] = useState("");
  const [rangeTrades, setRangeTrades] = useState<Set<string>>(new Set());
  const [rangeResult, setRangeResult] = useState<LaborCostByDateRangeResponse | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);

  function toggleRangeTrade(trade: string) {
    setRangeTrades((prev) => {
      const next = new Set(prev);
      if (next.has(trade)) next.delete(trade);
      else next.add(trade);
      return next;
    });
  }

  async function calculateRangeLaborCost() {
    if (!rangeFromDate || !rangeToDate) {
      setRangeError("Pick both a from date and a to date");
      return;
    }
    setRangeLoading(true);
    setRangeError(null);
    try {
      const tradesParam = rangeTrades.size > 0 ? `&trades=${encodeURIComponent([...rangeTrades].join(","))}` : "";
      const res = await apiClient.get<LaborCostByDateRangeResponse>(
        `/hr/reports/labor-cost-by-date-range?fromDate=${rangeFromDate}&toDate=${rangeToDate}${tradesParam}`,
      );
      setRangeResult(res.data);
    } catch (err: any) {
      setRangeError(err?.response?.data?.message ?? "Failed to calculate labor cost");
    } finally {
      setRangeLoading(false);
    }
  }

  function downloadEmployeeCostReportPdf() {
    const rows = (dashboard?.groups ?? []).flatMap((g) =>
      g.rows.map((r) => [
        r.code,
        r.nameEn,
        r.designation?.trim() || "Unspecified",
        Number(r.hoursWorked),
        Number(r.cost).toFixed(2),
      ]),
    );
    downloadPdf(
      `employee-cost-report-${scope}${scope === "period" ? `-${periodId}` : ""}.pdf`,
      "Employee Cost Report",
      [
        {
          headers: ["Code", "Name", "Trade", "Hours worked", "Cost (SAR)"],
          rows,
        },
      ],
    );
  }

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>Employees Overview</h2>
          <span>
            <button className="secondary" onClick={downloadEmployeeCostReport} disabled={!dashboard}>
              Download cost report (CSV)
            </button>{" "}
            <button className="secondary" onClick={downloadEmployeeCostReportPdf} disabled={!dashboard}>
              Download cost report (PDF)
            </button>{" "}
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
                  Paid — released employees (salary/food paid before release; not their final settlement) —{" "}
                  <a onClick={() => navigate("/hr/employees/overview/released")} style={{ cursor: "pointer" }}>view released employees</a>
                </span>
                <strong>{money(dashboard.totalPaidReleased)}</strong>
              </div>
              <div className="form-row" style={{ justifyContent: "space-between", paddingLeft: 20, fontSize: 13, color: "#667085" }}>
                <span>— of which salary (payroll + direct payments)</span>
                <span>{money(dashboard.paidSalary)}</span>
              </div>
              <div className="form-row" style={{ justifyContent: "space-between", paddingLeft: 20, fontSize: 13, color: "#667085" }}>
                <span>— of which allowances</span>
                <span>{money(dashboard.paidAllowance)}</span>
              </div>
              <div className="form-row" style={{ justifyContent: "space-between", paddingLeft: 20, fontSize: 13, color: "#667085" }}>
                <span>— of which food</span>
                <span>{money(dashboard.paidFood)}</span>
              </div>
              <div className="form-row" style={{ justifyContent: "space-between", paddingLeft: 20, fontSize: 13, color: "#667085" }}>
                <span>— of which advances</span>
                <span>{money(dashboard.paidAdvance)}</span>
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
                  Pending — released employees (unpaid logged hours before release; not their final settlement) —{" "}
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h3>Employees by trade</h3>
                <p style={{ color: "#667085", fontSize: 13, marginTop: 2 }}>
                  Headcount and accrued labor cost per trade/designation (e.g. Mason, Electrician) — for staffing and
                  cost-allocation decisions. {dailyCostCaption}
                </p>
              </div>
              <div className="button-group">
                <button className={tradeScope === "active" ? "" : "secondary"} onClick={() => setTradeScope("active")}>
                  Active only
                </button>
                <button className={tradeScope === "all" ? "" : "secondary"} onClick={() => setTradeScope("all")}>
                  Active + Released
                </button>
                <button className="secondary" onClick={downloadTradeBreakdown} disabled={tradeBreakdown.length === 0}>
                  Download (CSV)
                </button>
                <button className="secondary" onClick={downloadTradeBreakdownPdf} disabled={tradeBreakdown.length === 0}>
                  Download (PDF)
                </button>
              </div>
            </div>
            {tradeBreakdown.length === 0 ? (
              <p>No active employees.</p>
            ) : (
              <>
                <TradeBarChart data={tradeBreakdown} />
                <table style={{ marginTop: 16 }}>
                  <thead>
                    <tr>
                      <th>Trade</th>
                      <th>Headcount</th>
                      <th>Cost</th>
                      <th>% of total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tradeBreakdown.map((t) => (
                      <tr key={t.trade}>
                        <td>{t.trade}</td>
                        <td>{t.headcount}</td>
                        <td>{money(t.cost)}</td>
                        <td>{((t.cost / Math.max(Number(dashboard.grandTotal), 1)) * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>

          <div className="card">
            <h3>Labor cost by date range</h3>
            <p style={{ color: "#667085", fontSize: 13, marginTop: 2 }}>
              Like the Purchase Invoices date filter — pick any from/to date range (not tied to a fiscal period) and,
              optionally, tick specific trades to only count those employees. Same accrued cost basis as the rest of
              this page (hours worked × hourly rate).
            </p>
            <div className="form-row" style={{ marginTop: 10, flexWrap: "wrap" }}>
              <label style={{ display: "flex", flexDirection: "column", fontSize: 12, color: "#475467" }}>
                From
                <input type="date" value={rangeFromDate} onChange={(e) => setRangeFromDate(e.target.value)} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", fontSize: 12, color: "#475467" }}>
                To
                <input type="date" value={rangeToDate} onChange={(e) => setRangeToDate(e.target.value)} />
              </label>
              <button onClick={calculateRangeLaborCost} disabled={rangeLoading} style={{ alignSelf: "flex-end" }}>
                {rangeLoading ? "Calculating…" : "Calculate"}
              </button>
            </div>
            {tradeOptions.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <p style={{ fontSize: 12, color: "#475467", marginBottom: 6 }}>
                  Trades (tick one or more — leave all unticked to include everyone):
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
                  {tradeOptions.map((trade) => (
                    <label key={trade} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={rangeTrades.has(trade)}
                        onChange={() => toggleRangeTrade(trade)}
                      />
                      {trade}
                    </label>
                  ))}
                </div>
              </div>
            )}
            {rangeError && <div className="error-banner" style={{ marginTop: 10 }}>{rangeError}</div>}
            {rangeResult && (
              <div style={{ marginTop: 16 }}>
                <div className="kpi-grid">
                  <div className="kpi-tile" style={{ cursor: "default" }}>
                    <span className="kpi-label">Total labor cost</span>
                    <span className="kpi-value">{money(rangeResult.totalCost)}</span>
                  </div>
                  <div className="kpi-tile" style={{ cursor: "default" }}>
                    <span className="kpi-label">Total hours</span>
                    <span className="kpi-value">{Number(rangeResult.totalHours).toFixed(0)}</span>
                  </div>
                  <div className="kpi-tile" style={{ cursor: "default" }}>
                    <span className="kpi-label">Employees</span>
                    <span className="kpi-value">{rangeResult.employeeCount}</span>
                  </div>
                </div>
                {rangeResult.breakdown.length > 0 && (
                  <table style={{ marginTop: 16 }}>
                    <thead>
                      <tr>
                        <th>Trade</th>
                        <th>Employees</th>
                        <th>Hours</th>
                        <th>Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rangeResult.breakdown.map((row) => (
                        <tr key={row.trade}>
                          <td>{row.trade}</td>
                          <td>{row.employeeCount}</td>
                          <td>{Number(row.hours).toFixed(0)}</td>
                          <td>{money(row.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
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
