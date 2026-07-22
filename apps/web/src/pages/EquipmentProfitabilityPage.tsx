import { useEffect, useState } from "react";
import { apiClient } from "../api/client";

interface ProfitRow {
  contractId: string;
  code: string;
  name: string;
  status: string;
  customerName: string;
  unitCount: number;
  billed: string;
  depreciation: string;
  otherCosts: string;
  margin: string;
  marginPct: string;
}

export function EquipmentProfitabilityPage() {
  const [rows, setRows] = useState<ProfitRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient
      .get<ProfitRow[]>("/equipment/reports/contract-profitability")
      .then((res) => setRows(res.data))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="card">
      <h2>Equipment Contract Profitability</h2>
      <p style={{ color: "#667085", fontSize: 13 }}>
        Billed rental revenue (4500 by contract cost center) vs the assigned units' depreciation and other tagged
        costs (maintenance, repairs).
      </p>
      {loading ? (
        <p>Loading…</p>
      ) : rows.length === 0 ? (
        <p>No equipment rental contracts.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Contract</th>
              <th>Customer</th>
              <th>Status</th>
              <th>Units</th>
              <th>Billed</th>
              <th>Depreciation</th>
              <th>Other costs</th>
              <th>Margin</th>
              <th>Margin %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.contractId}>
                <td>
                  {row.code} — {row.name}
                </td>
                <td>{row.customerName}</td>
                <td>{row.status}</td>
                <td>{row.unitCount}</td>
                <td>{Number(row.billed).toFixed(2)}</td>
                <td>{Number(row.depreciation).toFixed(2)}</td>
                <td>{Number(row.otherCosts).toFixed(2)}</td>
                <td style={{ color: Number(row.margin) < 0 ? "#912018" : "#027a48" }}>{Number(row.margin).toFixed(2)}</td>
                <td>{Number(row.marginPct).toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
