import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../api/client";
import { formatSigned } from "../utils/currency";
import { useProjectFilter, ProjectScopeNote } from "../components/ProjectFilter";

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
  project?: { id: string; code: string; name: string };
}

// Maps each drillable display line to the "line" key the backend's
// GET /reports/cash-flow/line-detail endpoint expects (CASH_FLOW_LINES in
// reports.controller.ts). workingCapitalItems/financingItems are keyed by
// their index in that array, matching the fixed order the backend returns.
const WORKING_CAPITAL_LINE_KEYS = [
  "wcTradeReceivables",
  "wcInventory",
  "wcOtherCurrentAssets",
  "wcTradePayables",
  "wcOtherCurrentLiabilities",
  "wcEosb",
];
const FINANCING_LINE_KEYS = ["financingLongTermLoans", "financingShareCapital", "financingDividends", "financingFinanceCostsPaid"];

function firstDayOfYear() {
  const now = new Date();
  return new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
}

export function CashFlowPage() {
  const [fromDate, setFromDate] = useState(firstDayOfYear());
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<CashFlowReport | null>(null);
  const [loading, setLoading] = useState(true);
  const { projectId, projectQuery, picker } = useProjectFilter();

  useEffect(() => {
    setLoading(true);
    apiClient
      .get<CashFlowReport>("/reports/cash-flow", { params: { fromDate, toDate, projectId: projectId || undefined } })
      .then((res) => setReport(res.data))
      .finally(() => setLoading(false));
  }, [fromDate, toDate, projectId]);

  function lineHref(line: string) {
    return `/cash-flow/line/${line}?fromDate=${fromDate}&toDate=${toDate}${projectQuery}`;
  }

  return (
    <div className="card">
      <div className="form-row" style={{ justifyContent: "space-between" }}>
        <h2>Statement of Cash Flows</h2>
        <div className="form-row">
          {picker}
          <label>From </label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <label>To </label>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
      </div>
      {projectId && (
        <ProjectScopeNote project={report?.project}>
          Bank and cash movements are not tagged to a project, so the cash lines here are mostly empty and the statement will not reconcile. Equipment purchases are not tracked per project. Use the whole-company view for the real cash flow.
        </ProjectScopeNote>
      )}
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
                <td>{formatSigned(report.profitForPeriod)}</td>
              </tr>
              <tr>
                <td style={{ paddingLeft: "1.5rem" }}>
                  <Link to={lineHref("depreciation")}>Depreciation (non-cash addback)</Link>
                </td>
                <td>{formatSigned(report.depreciation)}</td>
              </tr>
              <tr>
                <td style={{ paddingLeft: "1.5rem" }}>
                  <Link to={lineHref("disposalGainLossAdjustment")}>(Gain)/loss on disposal of assets</Link>
                </td>
                <td>{formatSigned(report.disposalGainLossAdjustment)}</td>
              </tr>
              <tr>
                <td style={{ paddingLeft: "1.5rem" }}>
                  <Link to={lineHref("financeCostsAddback")}>Finance costs (classified as financing)</Link>
                </td>
                <td>{formatSigned(report.financeCostsAddback)}</td>
              </tr>
              {report.workingCapitalItems.map((item, i) => (
                <tr key={item.label}>
                  <td style={{ paddingLeft: "1.5rem" }}>
                    <Link to={lineHref(WORKING_CAPITAL_LINE_KEYS[i])}>{item.label}</Link>
                  </td>
                  <td>{formatSigned(item.amount)}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>Net cash from operating activities</strong>
                </td>
                <td>
                  <strong>{formatSigned(report.netCashFromOperating)}</strong>
                </td>
              </tr>

              <tr>
                <td colSpan={2}>
                  <strong>Investing Activities</strong>
                </td>
              </tr>
              <tr>
                <td style={{ paddingLeft: "1.5rem" }}>Purchase of equipment</td>
                <td>{formatSigned(report.equipmentPurchases)}</td>
              </tr>
              <tr>
                <td style={{ paddingLeft: "1.5rem" }}>Proceeds from disposal of equipment</td>
                <td>{formatSigned(report.disposalProceeds)}</td>
              </tr>
              <tr>
                <td>
                  <strong>Net cash from investing activities</strong>
                </td>
                <td>
                  <strong>{formatSigned(report.netCashFromInvesting)}</strong>
                </td>
              </tr>

              <tr>
                <td colSpan={2}>
                  <strong>Financing Activities</strong>
                </td>
              </tr>
              {report.financingItems.map((item, i) => (
                <tr key={item.label}>
                  <td style={{ paddingLeft: "1.5rem" }}>
                    <Link to={lineHref(FINANCING_LINE_KEYS[i])}>{item.label}</Link>
                  </td>
                  <td>{formatSigned(item.amount)}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>Net cash from financing activities</strong>
                </td>
                <td>
                  <strong>{formatSigned(report.netCashFromFinancing)}</strong>
                </td>
              </tr>

              <tr>
                <td>
                  <strong>Net change in cash and cash equivalents</strong>
                </td>
                <td>
                  <strong>{formatSigned(report.netChangeInCash)}</strong>
                </td>
              </tr>
              <tr>
                <td>Cash and cash equivalents at start of period</td>
                <td>{formatSigned(report.openingCash)}</td>
              </tr>
              <tr>
                <td>
                  <strong>Cash and cash equivalents at end of period</strong>
                </td>
                <td>
                  <strong>{formatSigned(report.closingCash)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
          <p className={report.isReconciled ? "balance-ok" : "balance-bad"}>
            {report.isReconciled
              ? "✓ Net change in cash reconciles to actual cash/bank movement"
              : projectId
                ? "Not reconciled — expected for a single-project view"
                : "✗ Statement does not reconcile — this should never happen"}
          </p>
        </>
      )}
    </div>
  );
}
