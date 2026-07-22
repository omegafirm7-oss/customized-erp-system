import { useEffect, useState } from "react";
import { apiClient } from "../api/client";

interface FinancialPositionLine {
  subClassCode: string;
  subClassName: string;
  balance: string;
}

interface FinancialPositionReport {
  asOfDate: string;
  currentAssets: FinancialPositionLine[];
  nonCurrentAssets: FinancialPositionLine[];
  currentLiabilities: FinancialPositionLine[];
  nonCurrentLiabilities: FinancialPositionLine[];
  equity: FinancialPositionLine[];
  totalAssets: string;
  totalLiabilities: string;
  totalEquity: string;
  isBalanced: boolean;
}

function LineGroup({ title, lines }: { title: string; lines: FinancialPositionLine[] }) {
  const total = lines.reduce((sum, l) => sum + Number(l.balance), 0);
  return (
    <>
      <tr>
        <td colSpan={2}>
          <strong>{title}</strong>
        </td>
      </tr>
      {lines.map((line) => (
        <tr key={line.subClassCode}>
          <td style={{ paddingLeft: "1.5rem" }}>{line.subClassName}</td>
          <td>{line.balance}</td>
        </tr>
      ))}
      <tr>
        <td style={{ paddingLeft: "1.5rem" }}>
          <em>Total {title}</em>
        </td>
        <td>
          <em>{total.toFixed(2)}</em>
        </td>
      </tr>
    </>
  );
}

export function FinancialPositionPage() {
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<FinancialPositionReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiClient
      .get<FinancialPositionReport>("/reports/financial-position", { params: { asOfDate } })
      .then((res) => setReport(res.data))
      .finally(() => setLoading(false));
  }, [asOfDate]);

  return (
    <div className="card">
      <div className="form-row" style={{ justifyContent: "space-between" }}>
        <h2>Statement of Financial Position</h2>
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
            <tbody>
              <LineGroup title="Current Assets" lines={report.currentAssets} />
              <LineGroup title="Non-Current Assets" lines={report.nonCurrentAssets} />
              <tr>
                <td>
                  <strong>Total Assets</strong>
                </td>
                <td>
                  <strong>{report.totalAssets}</strong>
                </td>
              </tr>
              <LineGroup title="Current Liabilities" lines={report.currentLiabilities} />
              <LineGroup title="Non-Current Liabilities" lines={report.nonCurrentLiabilities} />
              <tr>
                <td>
                  <strong>Total Liabilities</strong>
                </td>
                <td>
                  <strong>{report.totalLiabilities}</strong>
                </td>
              </tr>
              <LineGroup title="Equity" lines={report.equity} />
              <tr>
                <td>
                  <strong>Total Liabilities + Equity</strong>
                </td>
                <td>
                  <strong>{(Number(report.totalLiabilities) + Number(report.totalEquity)).toFixed(2)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
          <p className={report.isBalanced ? "balance-ok" : "balance-bad"}>
            {report.isBalanced ? "✓ Assets = Liabilities + Equity" : "✗ Statement does not balance — this should never happen"}
          </p>
        </>
      )}
    </div>
  );
}
