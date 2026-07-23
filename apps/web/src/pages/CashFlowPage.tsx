import { useEffect, useState } from "react";
import { apiClient } from "../api/client";

interface CashFlowReport {
  fromDate: string;
  toDate: string;
  profitForPeriod: string;
  depreciation: string;
  disposalGainLossAdjustment: string;
  financeCostsAddback: string;
  workingCapitalItems: Array<{ label: string; amount: string }>;
  netCashFromOperating: string;
  equipmentPurchases: string;
  disposalProceeds: string;
  netCashFromInvesting: string;
  financingItems: Array<{ label: string; amount: string }>;
  netCashFromFinancing: string;
  netChangeInCash: string;
  openingCash: string;
  closingCash: string;
  isReconciled: boolean;
}

function firstDayOfYear() {
  const now = new Date();
  return new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
}

export function CashFlowPage() {
  const [fromDate, setFromDate] = useState(firstDayOfYear());
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<CashFlowReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiClient
      .get<CashFlowReport>("/reports/cash-flow", { params: { fromDate, toDate } })
      .then((res) => setReport(res.data))
      .finally(() => setLoading(false));
  }, [fromDate, toDate]);

  return (
    <div className="card">
      <div className="form-row" style={{ justifyContent: "space-between" }}>
        <h2>Statement of Cash Flows</h2>
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
                <td colSpan={2}>
                  <strong>Operating Activities</strong>
                </td>
              </tr>
              <tr>
                <td style={{ paddingLeft: "1.5rem" }}>Profit for the Period</td>
                <td>{report.profitForPeriod}</td>
              </tr>
              <tr>
                <td style={{ paddingLeft: "1.5rem" }}>Depreciation (non-cash addback)</td>
                <td>{report.depreciation}</td>
              </tr>
              <tr>
                <td style={{ paddingLeft: "1.5rem" }}>(Gain)/loss on disposal of assets</td>
                <td>{report.disposalGainLossAdjustment}</td>
              </tr>
              <tr>
                <td style={{ paddingLeft: "1.5rem" }}>Finance costs (classified as financing)</td>
                <td>{report.financeCostsAddback}</td>
              </tr>
              {report.workingCapitalItems.map((item) => (
                <tr key={item.label}>
                  <td style={{ paddingLeft: "1.5rem" }}>{item.label}</td>
                  <td>{item.amount}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>Net cash from operating activities</strong>
                </td>
                <td>
                  <strong>{report.netCashFromOperating}</strong>
                </td>
              </tr>

              <tr>
                <td colSpan={2}>
                  <strong>Investing Activities</strong>
                </td>
              </tr>
              <tr>
                <td style={{ paddingLeft: "1.5rem" }}>Purchase of equipment</td>
                <td>{report.equipmentPurchases}</td>
              </tr>
              <tr>
                <td style={{ paddingLeft: "1.5rem" }}>Proceeds from disposal of equipment</td>
                <td>{report.disposalProceeds}</td>
              </tr>
              <tr>
                <td>
                  <strong>Net cash from investing activities</strong>
                </td>
                <td>
                  <strong>{report.netCashFromInvesting}</strong>
                </td>
              </tr>

              <tr>
                <td colSpan={2}>
                  <strong>Financing Activities</strong>
                </td>
              </tr>
              {report.financingItems.map((item) => (
                <tr key={item.label}>
                  <td style={{ paddingLeft: "1.5rem" }}>{item.label}</td>
                  <td>{item.amount}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>Net cash from financing activities</strong>
                </td>
                <td>
                  <strong>{report.netCashFromFinancing}</strong>
                </td>
              </tr>

              <tr>
                <td>
                  <strong>Net change in cash and cash equivalents</strong>
                </td>
                <td>
                  <strong>{report.netChangeInCash}</strong>
                </td>
              </tr>
              <tr>
                <td>Cash and cash equivalents at start of period</td>
                <td>{report.openingCash}</td>
              </tr>
              <tr>
                <td>
                  <strong>Cash and cash equivalents at end of period</strong>
                </td>
                <td>
                  <strong>{report.closingCash}</strong>
                </td>
              </tr>
            </tbody>
          </table>
          <p className={report.isReconciled ? "balance-ok" : "balance-bad"}>
            {report.isReconciled
              ? "✓ Net change in cash reconciles to actual cash/bank movement"
              : "✗ Statement does not reconcile — this should never happen"}
          </p>
        </>
      )}
    </div>
  );
}
