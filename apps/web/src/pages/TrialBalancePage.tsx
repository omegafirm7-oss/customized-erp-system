import { useEffect, useState } from "react";
import { apiClient } from "../api/client";

interface TrialBalanceRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  openingBalance: string;
  debit: string;
  credit: string;
  closingBalance: string;
}

interface TrialBalanceReport {
  asOfDate: string;
  rows: TrialBalanceRow[];
  totalDebit: string;
  totalCredit: string;
}

export function TrialBalancePage() {
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<TrialBalanceReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiClient
      .get<TrialBalanceReport>("/reports/trial-balance", { params: { asOfDate } })
      .then((res) => setReport(res.data))
      .finally(() => setLoading(false));
  }, [asOfDate]);

  const isBalanced = report && report.totalDebit === report.totalCredit;

  return (
    <div className="card">
      <div className="form-row" style={{ justifyContent: "space-between" }}>
        <h2>Trial Balance</h2>
        <div>
          <label>As of </label>
          <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
        </div>
      </div>
      {loading || !report ? (
        <p>Loading…</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Account</th>
                <th>Opening</th>
                <th>Debit</th>
                <th>Credit</th>
                <th>Closing</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.accountId}>
                  <td>{row.accountCode}</td>
                  <td>{row.accountName}</td>
                  <td>{row.openingBalance}</td>
                  <td>{row.debit}</td>
                  <td>{row.credit}</td>
                  <td>{row.closingBalance}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>
                  <strong>Totals</strong>
                </td>
                <td>
                  <strong>{report.totalDebit}</strong>
                </td>
                <td>
                  <strong>{report.totalCredit}</strong>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
          <p className={isBalanced ? "balance-ok" : "balance-bad"}>
            {isBalanced ? "✓ Total debits equal total credits" : "✗ Totals do not balance — this should never happen"}
          </p>
        </>
      )}
    </div>
  );
}
