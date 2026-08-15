import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../api/client";
import { formatAmount, formatSigned } from "../utils/currency";

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

// The equity group's "Current Year Earnings" line is computed on the fly
// from unposted-to-equity P&L activity, not a real GL sub-class — it has no
// accounts to drill into, so it's the one line left unclickable below.
const SYNTHETIC_LINE_CODE = "CURRENT_YEAR_EARNINGS";

function LineGroup({ title, lines, asOfDate }: { title: string; lines: FinancialPositionLine[]; asOfDate: string }) {
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
          <td style={{ paddingLeft: "1.5rem" }}>
            {line.subClassCode === SYNTHETIC_LINE_CODE ? (
              line.subClassName
            ) : (
              <Link to={`/financial-position/line/${line.subClassCode}?asOfDate=${asOfDate}`}>{line.subClassName}</Link>
            )}
          </td>
          <td>{formatSigned(line.balance)}</td>
        </tr>
      ))}
      <tr>
        <td style={{ paddingLeft: "1.5rem" }}>
          <em>Total {title}</em>
        </td>
        <td>
          <em>{formatAmount(total)}</em>
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
              <LineGroup title="Current Assets" lines={report.currentAssets} asOfDate={asOfDate} />
              <LineGroup title="Non-Current Assets" lines={report.nonCurrentAssets} asOfDate={asOfDate} />
              <tr>
                <td>
                  <strong>Total Assets</strong>
                </td>
                <td>
                  <strong>{formatAmount(report.totalAssets)}</strong>
                </td>
              </tr>
              <LineGroup title="Current Liabilities" lines={report.currentLiabilities} asOfDate={asOfDate} />
              <LineGroup title="Non-Current Liabilities" lines={report.nonCurrentLiabilities} asOfDate={asOfDate} />
              <tr>
                <td>
                  <strong>Total Liabilities</strong>
                </td>
                <td>
                  <strong>{formatAmount(report.totalLiabilities)}</strong>
                </td>
              </tr>
              <LineGroup title="Equity" lines={report.equity} asOfDate={asOfDate} />
              <tr>
                <td>
                  <strong>Total Liabilities + Equity</strong>
                </td>
                <td>
                  <strong>{formatAmount(Number(report.totalLiabilities) + Number(report.totalEquity))}</strong>
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
