import { useEffect, useState } from "react";
import { apiClient } from "../api/client";

interface WipRow {
  projectId: string;
  code: string;
  name: string;
  status: string;
  contractValue: string;
  estimatedTotalCost: string;
  costsToDate: string;
  percentComplete: string;
  revenueRecognized: string;
  billedToDate: string;
  contractAsset: string;
  contractLiability: string;
}

export function WipSchedulePage() {
  const [rows, setRows] = useState<WipRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient
      .get<WipRow[]>("/reports/wip-schedule")
      .then((res) => setRows(res.data))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="card">
      <h2>WIP Schedule (Over-Time Contracts)</h2>
      <p style={{ color: "#667085", fontSize: 13 }}>
        Contract asset = revenue recognized in excess of billings (underbilled). Contract liability = billings in
        excess of revenue recognized (overbilled).
      </p>
      {loading ? (
        <p>Loading…</p>
      ) : rows.length === 0 ? (
        <p>No over-time (POC) projects.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Project</th>
              <th>Contract</th>
              <th>Est. Cost</th>
              <th>Costs to Date</th>
              <th>POC %</th>
              <th>Recognized</th>
              <th>Billed</th>
              <th>Contract Asset</th>
              <th>Contract Liability</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.projectId}>
                <td>
                  {row.code} — {row.name}
                </td>
                <td>{row.contractValue}</td>
                <td>{row.estimatedTotalCost}</td>
                <td>{row.costsToDate}</td>
                <td>{row.percentComplete}%</td>
                <td>{row.revenueRecognized}</td>
                <td>{row.billedToDate}</td>
                <td>{row.contractAsset}</td>
                <td>{row.contractLiability}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
