import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../api/client";
import { downloadCsv } from "../utils/csv";
import { formatAmount } from "../utils/currency";

interface ReportRow {
  projectId: string;
  code: string;
  name: string;
  materialCost: string;
  machineryCost: string;
  laborCost: string;
  totalCost: string;
}

interface Report {
  fromDate: string;
  toDate: string;
  rows: ReportRow[];
  totals: { materialCost: string; machineryCost: string; laborCost: string; totalCost: string };
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthToRange(month: string): { fromDate: string; toDate: string } {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { fromDate: `${month}-01`, toDate: `${month}-${String(lastDay).padStart(2, "0")}` };
}

/**
 * All-projects cost report for a calendar month — Material, Machinery, and
 * Labor cost per project, with a total row, so a month can be checked at a
 * glance instead of opening each project's own intelligence page.
 */
export function ProjectMonthlyCostReportPage() {
  const [month, setMonth] = useState(currentMonth());
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load(m: string) {
    const { fromDate, toDate } = monthToRange(m);
    setLoading(true);
    setError(null);
    apiClient
      .get<Report>("/projects/monthly-cost-report", { params: { fromDate, toDate } })
      .then((res) => setReport(res.data))
      .catch((err) => setError(err?.response?.data?.message ?? "Failed to load report"))
      .finally(() => setLoading(false));
  }

  useEffect(() => load(month), []); // eslint-disable-line react-hooks/exhaustive-deps

  function downloadReport() {
    if (!report) return;
    downloadCsv(
      `project-cost-report-${month}.csv`,
      ["Project code", "Project name", "Material cost", "Machinery cost", "Labor cost", "Total cost"],
      [
        ...report.rows.map((r) => [r.code, r.name, r.materialCost, r.machineryCost, r.laborCost, r.totalCost]),
        ["", "Total", report.totals.materialCost, report.totals.machineryCost, report.totals.laborCost, report.totals.totalCost],
      ],
    );
  }

  return (
    <div className="intelligence-board">
      <Link to="/projects" className="intelligence-crumb">
        ← Back to Projects
      </Link>
      <div className="intelligence-panel-header">
        <div className="intelligence-panel-title">Monthly project cost report</div>
      </div>
      <div className="form-row" style={{ alignItems: "center" }}>
        <label>
          Month{" "}
          <input
            type="month"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              load(e.target.value);
            }}
          />
        </label>
        <button type="button" onClick={downloadReport} disabled={!report || report.rows.length === 0}>
          Download CSV
        </button>
      </div>
      {error && <div className="error-banner">{error}</div>}
      {loading && <p>Loading…</p>}
      {report && !loading && (
        <table>
          <thead>
            <tr>
              <th>Project</th>
              <th>Material</th>
              <th>Machinery</th>
              <th>Labor</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.projectId}>
                <td>
                  <Link to={`/projects/${r.projectId}`}>
                    {r.code} — {r.name}
                  </Link>
                </td>
                <td>{formatAmount(r.materialCost)}</td>
                <td>{formatAmount(r.machineryCost)}</td>
                <td>{formatAmount(r.laborCost)}</td>
                <td>{formatAmount(r.totalCost)}</td>
              </tr>
            ))}
            {report.rows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: "#98a2b3" }}>
                  No project costs recorded for this month
                </td>
              </tr>
            )}
          </tbody>
          {report.rows.length > 0 && (
            <tfoot>
              <tr>
                <td>
                  <strong>Total</strong>
                </td>
                <td>
                  <strong>{formatAmount(report.totals.materialCost)}</strong>
                </td>
                <td>
                  <strong>{formatAmount(report.totals.machineryCost)}</strong>
                </td>
                <td>
                  <strong>{formatAmount(report.totals.laborCost)}</strong>
                </td>
                <td>
                  <strong>{formatAmount(report.totals.totalCost)}</strong>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      )}
    </div>
  );
}
