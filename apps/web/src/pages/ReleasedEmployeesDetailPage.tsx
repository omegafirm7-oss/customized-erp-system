import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiClient } from "../api/client";

interface FiscalPeriod {
  id: string;
}

interface ReleasedRow {
  employeeId: string;
  code: string;
  nameEn: string;
  designation: string | null;
  terminationDate: string | null;
  settlementNumber: string | null;
  reason: string | null;
  netAmount: string | null;
  paidAmount: string | null;
  pendingAmount: string | null;
  settlementStatus: string | null;
}

function money(v: string | number | null): string {
  return v === null ? "—" : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ReleasedEmployeesDetailPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ReleasedRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // releasedEmployees is company-wide, not period-scoped — any valid period id works.
      const periods = await apiClient.get<FiscalPeriod[]>("/companies/current/fiscal-periods");
      const periodId = periods.data[0]?.id;
      if (!periodId) {
        setRows([]);
        return;
      }
      const res = await apiClient.get<{ releasedEmployees: ReleasedRow[] }>(`/hr/reports/employees-dashboard?fiscalPeriodId=${periodId}`);
      setRows(res.data.releasedEmployees);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>Released Employees — Detail</h2>
          <button className="secondary" onClick={() => navigate("/hr/employees/overview")}>
            Back to Overview
          </button>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <p>Loading…</p>
        ) : rows.length === 0 ? (
          <p>No released employees.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Trade</th>
                <th>Release date</th>
                <th>Reason</th>
                <th>Net</th>
                <th>Paid</th>
                <th>Pending</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.employeeId}>
                  <td>
                    <Link to={`/hr/employees/${row.employeeId}`}>{row.code}</Link>
                  </td>
                  <td>{row.nameEn}</td>
                  <td>{row.designation ?? "—"}</td>
                  <td>{row.terminationDate ? new Date(row.terminationDate).toLocaleDateString() : "—"}</td>
                  <td>{row.reason ?? "—"}</td>
                  <td>{money(row.netAmount)}</td>
                  <td>{money(row.paidAmount)}</td>
                  <td>{money(row.pendingAmount)}</td>
                  <td>
                    {row.settlementStatus && (
                      <span className={`badge ${row.settlementStatus === "POSTED" ? "posted" : "reversed"}`}>{row.settlementStatus}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
