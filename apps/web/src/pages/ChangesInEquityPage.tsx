import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../api/client";
import { formatAmount, formatSigned } from "../utils/currency";

interface EquityChangeLine {
  subClassCode: string;
  subClassName: string;
  opening: string;
  profitForPeriod: string;
  otherMovements: string;
  closing: string;
}

interface EquityChangesReport {
  fromDate: string;
  toDate: string;
  lines: EquityChangeLine[];
  totalOpening: string;
  totalProfitForPeriod: string;
  totalOtherMovements: string;
  totalClosing: string;
}

function firstDayOfYear() {
  const now = new Date();
  return new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
}

export function ChangesInEquityPage() {
  const [fromDate, setFromDate] = useState(firstDayOfYear());
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<EquityChangesReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiClient
      .get<EquityChangesReport>("/reports/changes-in-equity", { params: { fromDate, toDate } })
      .then((res) => setReport(res.data))
      .finally(() => setLoading(false));
  }, [fromDate, toDate]);

  function columnHref(subClassCode: string, column: "opening" | "otherMovements") {
    return `/changes-in-equity/line/${subClassCode}/${column}?fromDate=${fromDate}&toDate=${toDate}`;
  }

  return (
    <div className="card">
      <div className="form-row" style={{ justifyContent: "space-between" }}>
        <h2>Statement of Changes in Equity</h2>
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
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Opening Balance</th>
              <th>Profit for the Period</th>
              <th>Other Movements</th>
              <th>Closing Balance</th>
            </tr>
          </thead>
          <tbody>
            {report.lines.map((line) => (
              <tr key={line.subClassCode}>
                <td>{line.subClassName}</td>
                <td>
                  <Link to={columnHref(line.subClassCode, "opening")}>{formatSigned(line.opening)}</Link>
                </td>
                <td>{formatSigned(line.profitForPeriod)}</td>
                <td>
                  <Link to={columnHref(line.subClassCode, "otherMovements")}>{formatSigned(line.otherMovements)}</Link>
                </td>
                <td>{formatSigned(line.closing)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>
                <strong>Total</strong>
              </td>
              <td>
                <strong>{formatAmount(report.totalOpening)}</strong>
              </td>
              <td>
                <strong>{formatAmount(report.totalProfitForPeriod)}</strong>
              </td>
              <td>
                <strong>{formatAmount(report.totalOtherMovements)}</strong>
              </td>
              <td>
                <strong>{formatAmount(report.totalClosing)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
