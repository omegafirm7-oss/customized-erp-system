import { useEffect, useState } from "react";
import { apiClient } from "../api/client";

interface AgingRow {
  businessPartnerId: string;
  partnerCode: string;
  partnerName: string;
  current: string;
  days1to30: string;
  days31to60: string;
  days61to90: string;
  days90plus: string;
  total: string;
}

interface AgingReport {
  asOfDate: string;
  rows: AgingRow[];
  totals: Omit<AgingRow, "businessPartnerId" | "partnerCode" | "partnerName">;
}

export function AgingPage({ side }: { side: "ar" | "ap" }) {
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<AgingReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiClient
      .get<AgingReport>(`/reports/${side}-aging`, { params: { asOfDate } })
      .then((res) => setReport(res.data))
      .finally(() => setLoading(false));
  }, [side, asOfDate]);

  return (
    <div className="card">
      <div className="form-row" style={{ justifyContent: "space-between" }}>
        <h2>{side === "ar" ? "AR Aging (Receivables)" : "AP Aging (Payables)"}</h2>
        <div>
          <label>As of </label>
          <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
        </div>
      </div>
      {loading || !report ? (
        <p>Loading…</p>
      ) : report.rows.length === 0 ? (
        <p>No open {side === "ar" ? "receivables" : "payables"}.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Partner</th>
              <th>Current</th>
              <th>1–30</th>
              <th>31–60</th>
              <th>61–90</th>
              <th>90+</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={row.businessPartnerId}>
                <td>
                  {row.partnerCode} — {row.partnerName}
                </td>
                <td>{row.current}</td>
                <td>{row.days1to30}</td>
                <td>{row.days31to60}</td>
                <td>{row.days61to90}</td>
                <td>{row.days90plus}</td>
                <td>
                  <strong>{row.total}</strong>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>
                <strong>Totals</strong>
              </td>
              <td>
                <strong>{report.totals.current}</strong>
              </td>
              <td>
                <strong>{report.totals.days1to30}</strong>
              </td>
              <td>
                <strong>{report.totals.days31to60}</strong>
              </td>
              <td>
                <strong>{report.totals.days61to90}</strong>
              </td>
              <td>
                <strong>{report.totals.days90plus}</strong>
              </td>
              <td>
                <strong>{report.totals.total}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}

export function ArAgingPage() {
  return <AgingPage side="ar" />;
}

export function ApAgingPage() {
  return <AgingPage side="ap" />;
}
