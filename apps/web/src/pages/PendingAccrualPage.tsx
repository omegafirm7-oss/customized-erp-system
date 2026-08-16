import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../api/client";
import { formatAmount } from "../utils/currency";

interface PendingRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  status: string;
  category: "SALARY" | "FOOD";
  month: string;
  amount: string;
}

interface PendingAccrualResponse {
  rows: PendingRow[];
  totalPendingSalary: string;
  totalPendingFood: string;
  total: string;
}

function monthLabel(month: string): string {
  const [year, m] = month.split("-");
  return new Date(Number(year), Number(m) - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export function PendingAccrualPage() {
  const [data, setData] = useState<PendingAccrualResponse | null>(null);

  useEffect(() => {
    apiClient.get<PendingAccrualResponse>("/hr/reports/pending-accrual").then((res) => setData(res.data));
  }, []);

  if (!data) return <p style={{ padding: 24 }}>Loading…</p>;

  return (
    <div className="intelligence-board">
      <Link to="/hr/employees/overview" className="intelligence-crumb">
        ← Back to Employees Overview
      </Link>
      <div className="intelligence-panel-header">
        <div className="intelligence-panel-title">Pending Salary/Food by employee and month</div>
        <div style={{ display: "flex", gap: 12 }}>
          <div className="intelligence-total-pill">
            <div className="label">Salary pending</div>
            <div className="value">{formatAmount(data.totalPendingSalary)}</div>
          </div>
          <div className="intelligence-total-pill">
            <div className="label">Food pending</div>
            <div className="value">{formatAmount(data.totalPendingFood)}</div>
          </div>
          <div className="intelligence-total-pill">
            <div className="label">Total</div>
            <div className="value">{formatAmount(data.total)}</div>
          </div>
        </div>
      </div>
      <p style={{ color: "#98a2b3", fontSize: 13, marginTop: -8 }}>
        Money owed for work already logged (Salary) or a worked month's food allowance not yet paid — allocated to the oldest unpaid
        month first, so an employee with several months behind shows exactly which ones are still short.
      </p>
      <table>
        <thead>
          <tr>
            <th>Month</th>
            <th>Employee</th>
            <th>Status</th>
            <th>Category</th>
            <th>Pending amount</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={`${r.employeeId}-${r.category}-${r.month}`}>
              <td>{monthLabel(r.month)}</td>
              <td>
                <Link to={`/hr/employees/${r.employeeId}`}>
                  {r.employeeCode} — {r.employeeName}
                </Link>
              </td>
              <td>{r.status === "ACTIVE" ? "Active" : "Released"}</td>
              <td>{r.category === "SALARY" ? "Salary" : "Food"}</td>
              <td>{formatAmount(r.amount)}</td>
            </tr>
          ))}
          {data.rows.length === 0 && (
            <tr>
              <td colSpan={5} style={{ color: "#98a2b3" }}>
                Nothing pending — everything accrued so far has been paid
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
