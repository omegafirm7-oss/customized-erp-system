import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiClient } from "../api/client";

interface LaborPayment {
  source: "ALLOWANCE" | "FOOD" | "SALARY" | "PAYROLL" | "SETTLEMENT";
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
  const [searchParams] = useSearchParams();
  const accountId = searchParams.get("accountId");
  const [payments, setPayments] = useState<LaborPayment[] | null>(null);

  useEffect(() => {
    if (!id) return;
    setPayments(null);
    const query = accountId ? `?accountId=${accountId}` : "";
    apiClient.get<LaborPayment[]>(`/projects/${id}/costs/labor${query}`).then((res) => setPayments(res.data));
  }, [id, accountId]);

  if (!payments) return <p style={{ padding: 24 }}>Loading…</p>;

  const total = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const accountLabel = payments[0]?.accountCode ? `${payments[0].accountCode} — ${payments[0].accountName}` : null;

  return (
    <div className="intelligence-board">
      <Link to={`/projects/${id}`} className="intelligence-crumb">
        ← Back to project
      </Link>
      <div className="intelligence-panel-header">
        <div className="intelligence-panel-title">
          <span style={{ fontSize: 28 }}>{"\u{1F477}"}</span>
          {accountId && accountLabel ? `Labor — ${accountLabel}` : "Labor — allowances & payroll"}
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
                <span className={`source-pill ${p.source === "PAYROLL" || p.source === "SETTLEMENT" ? "payroll" : "allowance"}`}>
                  {p.source === "ALLOWANCE"
                    ? "Allowance"
                    : p.source === "FOOD"
                      ? "Food"
                      : p.source === "SALARY"
                        ? "Salary"
                        : p.source === "SETTLEMENT"
                          ? "Settlement"
                          : "Payroll"}
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
