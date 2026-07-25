import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiClient } from "../api/client";

interface LaborPayment {
  source: "ALLOWANCE" | "PAYROLL";
  employeeId: string | null;
  employeeCode: string | null;
  employeeName: string | null;
  accountCode: string | null;
  accountName: string | null;
  amount: string;
  date: string;
  memo: string | null;
  payrollRunId: string | null;
  payrollRunNumber: string | null;
}

export function ProjectLaborDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [payments, setPayments] = useState<LaborPayment[] | null>(null);

  useEffect(() => {
    if (!id) return;
    apiClient.get<LaborPayment[]>(`/projects/${id}/costs/labor`).then((res) => setPayments(res.data));
  }, [id]);

  if (!payments) return <p style={{ padding: 24 }}>Loading…</p>;

  const total = payments.reduce((sum, p) => sum + Number(p.amount), 0);

  return (
    <div className="intelligence-board">
      <Link to={`/projects/${id}`} className="intelligence-crumb">
        ← Back to project
      </Link>
      <div className="intelligence-panel-header">
        <div className="intelligence-panel-title">
          <span style={{ fontSize: 28 }}>{"\u{1F477}"}</span>
          Labor — allowances &amp; payroll
        </div>
        <div className="intelligence-total-pill">
          <div className="label">Total</div>
          <div className="value">{total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Source</th>
            <th>Employee</th>
            <th>Account</th>
            <th>Amount</th>
            <th>Date</th>
            <th>Reference</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p, i) => (
            <tr key={i}>
              <td>
                <span className={`source-pill ${p.source === "ALLOWANCE" ? "allowance" : "payroll"}`}>
                  {p.source === "ALLOWANCE" ? "Allowance" : "Payroll"}
                </span>
              </td>
              <td>
                {p.employeeId ? (
                  <Link to={`/hr/employees/${p.employeeId}`}>
                    {p.employeeCode} — {p.employeeName}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
              <td>{p.accountCode ? `${p.accountCode} — ${p.accountName}` : "—"}</td>
              <td>{Number(p.amount).toFixed(2)}</td>
              <td>{new Date(p.date).toLocaleDateString()}</td>
              <td>
                {p.source === "PAYROLL" && p.payrollRunId ? (
                  <Link to={`/hr/payroll-runs/${p.payrollRunId}`}>{p.payrollRunNumber ?? "Run"}</Link>
                ) : (
                  p.memo ?? ""
                )}
              </td>
            </tr>
          ))}
          {payments.length === 0 && (
            <tr>
              <td colSpan={6} style={{ color: "#98a2b3" }}>
                No labor costs recorded for this project yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
