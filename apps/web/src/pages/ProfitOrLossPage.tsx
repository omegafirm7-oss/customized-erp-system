import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiClient } from "../api/client";
import { useHasPermission } from "../hooks/useHasPermission";
import { formatAmount, formatSigned } from "../utils/currency";

interface ProfitOrLossReport {
  fromDate: string;
  toDate: string;
  operatingRevenue: string;
  costOfSales: string;
  operatingExpense: string;
  operatingProfit: string;
  investingIncome: string;
  profitBeforeFinancingAndTax: string;
  financeCosts: string;
  taxExpense: string;
  profitForThePeriod: string;
  project?: { id: string; code: string; name: string };
  managementPerformanceMeasures: Array<{
    name: string;
    value: string;
    reconciliation: Array<{ label: string; amount: string }>;
  }>;
}

function firstDayOfYear() {
  const now = new Date();
  return new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
}

export function ProfitOrLossPage() {
  const [fromDate, setFromDate] = useState(firstDayOfYear());
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<ProfitOrLossReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchParams] = useSearchParams();
  const [projectId, setProjectId] = useState(searchParams.get("projectId") ?? "");
  const [projects, setProjects] = useState<Array<{ id: string; code: string; name: string }>>([]);
  // Project-only viewers (e.g. investors) can't see company-wide figures: they get the project picker without "Whole company".
  const canSeeWholeCompany = useHasPermission("reports.view");
  const projectQuery = projectId ? `&projectId=${projectId}` : "";

  useEffect(() => {
    // Users without project access simply don't get the Project picker.
    apiClient.get<Array<{ id: string; code: string; name: string }>>("/projects").then((res) => setProjects(res.data)).catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    if (!canSeeWholeCompany && !projectId && projects.length > 0) setProjectId(projects[0].id);
  }, [canSeeWholeCompany, projectId, projects]);

  useEffect(() => {
    if (!canSeeWholeCompany && !projectId) return;
    setLoading(true);
    apiClient
      .get<ProfitOrLossReport>("/reports/profit-or-loss", { params: { fromDate, toDate, projectId: projectId || undefined } })
      .then((res) => setReport(res.data))
      .finally(() => setLoading(false));
  }, [fromDate, toDate, projectId]);

  const ebitda = report?.managementPerformanceMeasures.find((m) => m.name === "EBITDA");

  return (
    <div className="card">
      <div className="form-row" style={{ justifyContent: "space-between" }}>
        <h2>Statement of Profit or Loss</h2>
        <div className="form-row">
          {projects.length > 0 && (
            <>
              <label>Project </label>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                {canSeeWholeCompany && <option value="">Whole company</option>}
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.name}
                  </option>
                ))}
              </select>
            </>
          )}
          <label>From </label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <label>To </label>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
      </div>
      {projectId && report?.project && (
        <div className="note" style={{ background: "#f8f9fb", border: "1px solid #e4e7ec", borderRadius: 6, padding: "8px 12px", margin: "8px 0", fontSize: 13 }}>
          Showing only entries posted to <strong>{report.project.code} — {report.project.name}</strong>. Revenue appears only for invoices tagged to the
          project, and staff wages appear when paid (not accrued from timesheets), so this can differ from the Project Intelligence labor figure.
        </div>
      )}
      {loading || !report ? (
        <p>Loading…</p>
      ) : (
        <>
          <table>
            <tbody>
              <tr>
                <td>
                  <Link to={`/profit-or-loss/line/operatingRevenue?fromDate=${fromDate}&toDate=${toDate}${projectQuery}`}>Operating Revenue</Link>
                </td>
                <td>{formatSigned(report.operatingRevenue)}</td>
              </tr>
              <tr>
                <td>
                  <Link to={`/profit-or-loss/line/costOfSales?fromDate=${fromDate}&toDate=${toDate}${projectQuery}`}>Cost of Sales</Link>
                </td>
                <td>({formatAmount(report.costOfSales)})</td>
              </tr>
              <tr>
                <td>
                  <Link to={`/profit-or-loss/line/operatingExpense?fromDate=${fromDate}&toDate=${toDate}${projectQuery}`}>
                    Operating Expenses
                  </Link>
                </td>
                <td>({formatAmount(report.operatingExpense)})</td>
              </tr>
              <tr>
                <td>
                  <strong>Operating Profit</strong>
                </td>
                <td>
                  <strong>{formatSigned(report.operatingProfit)}</strong>
                </td>
              </tr>
              <tr>
                <td>
                  <Link to={`/profit-or-loss/line/investingIncome?fromDate=${fromDate}&toDate=${toDate}${projectQuery}`}>
                    Investing Income/(Expense)
                  </Link>
                </td>
                <td>{formatSigned(report.investingIncome)}</td>
              </tr>
              <tr>
                <td>
                  <strong>Profit before financing and income tax</strong>
                </td>
                <td>
                  <strong>{formatSigned(report.profitBeforeFinancingAndTax)}</strong>
                </td>
              </tr>
              <tr>
                <td>
                  <Link to={`/profit-or-loss/line/financeCosts?fromDate=${fromDate}&toDate=${toDate}${projectQuery}`}>Finance Costs</Link>
                </td>
                <td>({formatAmount(report.financeCosts)})</td>
              </tr>
              <tr>
                <td>
                  <Link to={`/profit-or-loss/line/taxExpense?fromDate=${fromDate}&toDate=${toDate}${projectQuery}`}>Tax Expense</Link>
                </td>
                <td>({formatAmount(report.taxExpense)})</td>
              </tr>
              <tr>
                <td>
                  <strong>Profit for the Period</strong>
                </td>
                <td>
                  <strong>{formatSigned(report.profitForThePeriod)}</strong>
                </td>
              </tr>
            </tbody>
          </table>

          {ebitda && (
            <div style={{ marginTop: "1.5rem" }}>
              <h3>Management Performance Measure: EBITDA</h3>
              <table>
                <thead>
                  <tr>
                    <th>Reconciliation</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {ebitda.reconciliation.map((line) => (
                    <tr key={line.label}>
                      <td>{line.label}</td>
                      <td>{formatSigned(line.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
