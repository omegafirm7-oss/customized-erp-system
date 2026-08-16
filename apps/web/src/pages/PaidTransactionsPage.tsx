import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../api/client";
import { AttachmentViewer } from "../components/AttachmentViewer";
import { formatAmount } from "../utils/currency";

interface PaidTransaction {
  paymentId: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  category: "SALARY" | "FOOD";
  amount: string;
  month: string;
  paymentDate: string;
  memo: string | null;
  attachmentFilename: string | null;
  attachmentMimeType: string | null;
}

interface PaidTransactionsResponse {
  transactions: PaidTransaction[];
  totalSalary: string;
  totalFood: string;
  total: string;
}

function monthLabel(month: string): string {
  const [year, m] = month.split("-");
  return new Date(Number(year), Number(m) - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export function PaidTransactionsPage() {
  const [data, setData] = useState<PaidTransactionsResponse | null>(null);
  const [viewer, setViewer] = useState<{ paymentId: string; filename: string; mimeType: string } | null>(null);

  useEffect(() => {
    apiClient.get<PaidTransactionsResponse>("/hr/reports/paid-transactions").then((res) => setData(res.data));
  }, []);

  if (!data) return <p style={{ padding: 24 }}>Loading…</p>;

  return (
    <div className="intelligence-board">
      <Link to="/hr/employees/overview" className="intelligence-crumb">
        ← Back to Employees Overview
      </Link>
      <div className="intelligence-panel-header">
        <div className="intelligence-panel-title">All paid Salary/Food transactions</div>
        <div style={{ display: "flex", gap: 12 }}>
          <div className="intelligence-total-pill">
            <div className="label">Salary paid</div>
            <div className="value">{formatAmount(data.totalSalary)}</div>
          </div>
          <div className="intelligence-total-pill">
            <div className="label">Food paid</div>
            <div className="value">{formatAmount(data.totalFood)}</div>
          </div>
          <div className="intelligence-total-pill">
            <div className="label">Total</div>
            <div className="value">{formatAmount(data.total)}</div>
          </div>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Month</th>
            <th>Employee</th>
            <th>Category</th>
            <th>Amount</th>
            <th>Memo</th>
            <th>Evidence</th>
          </tr>
        </thead>
        <tbody>
          {data.transactions.map((t) => (
            <tr key={t.paymentId}>
              <td>{new Date(t.paymentDate).toLocaleDateString()}</td>
              <td>{monthLabel(t.month)}</td>
              <td>
                <Link to={`/hr/employees/${t.employeeId}`}>
                  {t.employeeCode} — {t.employeeName}
                </Link>
              </td>
              <td>{t.category === "SALARY" ? "Salary" : "Food"}</td>
              <td>{formatAmount(t.amount)}</td>
              <td>{t.memo ?? "—"}</td>
              <td>
                {t.attachmentFilename ? (
                  <button
                    className="secondary"
                    onClick={() =>
                      setViewer({ paymentId: t.paymentId, filename: t.attachmentFilename!, mimeType: t.attachmentMimeType ?? "" })
                    }
                  >
                    View receipt
                  </button>
                ) : (
                  <span style={{ color: "#98a2b3" }}>No receipt</span>
                )}
              </td>
            </tr>
          ))}
          {data.transactions.length === 0 && (
            <tr>
              <td colSpan={7} style={{ color: "#98a2b3" }}>
                No Salary/Food payments recorded yet
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {viewer && (
        <AttachmentViewer
          filename={viewer.filename}
          mimeType={viewer.mimeType || undefined}
          fetchBlob={() =>
            apiClient.get(`/hr/employee-payments/${viewer.paymentId}/receipt`, { responseType: "blob" }).then((res) => res.data as Blob)
          }
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}
