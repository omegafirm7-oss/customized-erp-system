import { useEffect, useState } from "react";
import { apiClient } from "../api/client";

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

  useEffect(() => {
    setLoading(true);
    apiClient
      .get<ProfitOrLossReport>("/reports/profit-or-loss", { params: { fromDate, toDate } })
      .then((res) => setReport(res.data))
      .finally(() => setLoading(false));
  }, [fromDate, toDate]);

  const ebitda = report?.managementPerformanceMeasures.find((m) => m.name === "EBITDA");

  return (
    <div className="card">
      <div className="form-row" style={{ justifyContent: "space-between" }}>
        <h2>Statement of Profit or Loss</h2>
        <div className="form-row">
          <label>From </label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <label>To </label>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
      </div>
      {loading || !report ? (
        <p>Loading…</p>
      ) : (
        <>
          <table>
            <tbody>
              <tr>
                <td>Operating Revenue</td>
                <td>{report.operatingRevenue}</td>
              </tr>
              <tr>
                <td>Cost of Sales</td>
                <td>({report.costOfSales})</td>
              </tr>
              <tr>
                <td>Operating Expenses</td>
                <td>({report.operatingExpense})</td>
              </tr>
              <tr>
                <td>
                  <strong>Operating Profit</strong>
                </td>
                <td>
                  <strong>{report.operatingProfit}</strong>
                </td>
              </tr>
              <tr>
                <td>Investing Income/(Expense)</td>
                <td>{report.investingIncome}</td>
              </tr>
              <tr>
                <td>
                  <strong>Profit before financing and income tax</strong>
                </td>
                <td>
                  <strong>{report.profitBeforeFinancingAndTax}</strong>
                </td>
              </tr>
              <tr>
                <td>Finance Costs</td>
                <td>({report.financeCosts})</td>
              </tr>
              <tr>
                <td>Tax Expense</td>
                <td>({report.taxExpense})</td>
              </tr>
              <tr>
                <td>
                  <strong>Profit for the Period</strong>
                </td>
                <td>
                  <strong>{report.profitForThePeriod}</strong>
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
                      <td>{line.amount}</td>
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
