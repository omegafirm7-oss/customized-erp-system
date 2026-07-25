import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiClient } from "../api/client";

interface LaborPayment {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  accountCode: string | null;
  accountName: string | null;
  amount: string;
  paymentDate: string;
  memo: string | null;
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
    <div className="card">
      <p>
        <Link to={`/projects/${id}`}>← Back to project</Link>
      </p>
      <h2>Labor — allowance payments</h2>
      <div className="kpi-tile" style={{ maxWidth: 220 }}>
        <div>Total</div>
        <strong>{total.toFixed(2)}</strong>
      </div>
      <table>
        <thead>
          <tr>
            <th>Employee</th>
            <th>Account</th>
            <th>Amount</th>
            <th>Date</th>
            <th>Memo</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p, i) => (
            <tr key={i}>
              <td>
                <Link to={`/hr/employees/${p.employeeId}`}>
                  {p.employeeCode} — {p.employeeName}
                </Link>
              </td>
              <td>{p.accountCode ? `${p.accountCode} — ${p.accountName}` : "—"}</td>
              <td>{Number(p.amount).toFixed(2)}</td>
              <td>{new Date(p.paymentDate).toLocaleDateString()}</td>
              <td>{p.memo ?? ""}</td>
            </tr>
          ))}
          {payments.length === 0 && (
            <tr>
              <td colSpan={5} style={{ color: "#98a2b3" }}>
                No allowance payments recorded for employees on this project yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
