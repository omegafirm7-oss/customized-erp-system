import { useEffect, useState } from "react";
import { apiClient } from "../api/client";

interface FiscalPeriod {
  id: string;
  periodNumber: number;
  startDate: string;
  endDate: string;
}

interface GosiRow {
  employeeCode: string;
  nameEn: string;
  isSaudi: boolean;
  gosiNumber: string | null;
  gosiBase: string;
  employeeShare: string;
  employerShare: string;
  total: string;
}

interface GosiSummary {
  runNumber: string;
  period: { periodNumber: number };
  rows: GosiRow[];
  totals: { employeeShare: string; employerShare: string; total: string };
}

export function GosiSummaryPage() {
  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [periodId, setPeriodId] = useState("");
  const [summary, setSummary] = useState<GosiSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get<FiscalPeriod[]>("/companies/current/fiscal-periods").then((res) => setPeriods(res.data));
  }, []);

  async function loadSummary(id: string) {
    setPeriodId(id);
    setSummary(null);
    setError(null);
    if (!id) return;
    try {
      const res = await apiClient.get<GosiSummary>(`/hr/reports/gosi-summary?fiscalPeriodId=${id}`);
      setSummary(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to load summary");
    }
  }

  return (
    <div className="card">
      <h2>GOSI Summary</h2>
      <p style={{ color: "#667085", fontSize: 13 }}>
        Contribution breakdown for a period's posted payroll run — mirrors the monthly GOSI portal filing.
      </p>
      <div className="form-row">
        <select value={periodId} onChange={(e) => loadSummary(e.target.value)}>
          <option value="">Select fiscal period…</option>
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              Period {p.periodNumber} ({new Date(p.startDate).toLocaleDateString()} –{" "}
              {new Date(p.endDate).toLocaleDateString()})
            </option>
          ))}
        </select>
      </div>
      {error && <div className="error-banner">{error}</div>}
      {summary && (
        <>
          <p>
            Run <strong>{summary.runNumber}</strong> — Period {summary.period.periodNumber}
          </p>
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>GOSI number</th>
                <th>Type</th>
                <th>Wage base</th>
                <th>Employee share</th>
                <th>Employer share</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((row) => (
                <tr key={row.employeeCode}>
                  <td>
                    {row.employeeCode} — {row.nameEn}
                  </td>
                  <td>{row.gosiNumber ?? "—"}</td>
                  <td>{row.isSaudi ? "Saudi" : "Expat"}</td>
                  <td>{Number(row.gosiBase).toFixed(2)}</td>
                  <td>{Number(row.employeeShare).toFixed(2)}</td>
                  <td>{Number(row.employerShare).toFixed(2)}</td>
                  <td>{Number(row.total).toFixed(2)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 600 }}>
                <td colSpan={4}>Totals</td>
                <td>{Number(summary.totals.employeeShare).toFixed(2)}</td>
                <td>{Number(summary.totals.employerShare).toFixed(2)}</td>
                <td>{Number(summary.totals.total).toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

interface EosbRow {
  employeeId: string;
  code: string;
  nameEn: string;
  joinDate: string;
  serviceYears: string;
  eosbWage: string;
  entitlementToDate: string;
  provisionBooked: string;
}

interface LeaveRow {
  employeeId: string;
  code: string;
  nameEn: string;
  annualLeaveDays: string;
  accruedDays: string;
  takenDays: string;
  balanceDays: string;
  provisionValue: string;
  provisionBooked: string;
}

export function EosbLeavePage() {
  const [eosb, setEosb] = useState<EosbRow[]>([]);
  const [leave, setLeave] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiClient.get<EosbRow[]>("/hr/reports/eosb-liability"),
      apiClient.get<LeaveRow[]>("/hr/reports/leave-balances"),
    ])
      .then(([eosbRes, leaveRes]) => {
        setEosb(eosbRes.data);
        setLeave(leaveRes.data);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading…</p>;

  return (
    <div>
      <div className="card">
        <h2>End-of-Service Benefit Liability</h2>
        <p style={{ color: "#667085", fontSize: 13 }}>
          Art. 84 entitlement to date (full factor) vs the provision accrued through payroll runs.
        </p>
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Joined</th>
              <th>Service (yrs)</th>
              <th>EOSB wage</th>
              <th>Entitlement to date</th>
              <th>Provision booked</th>
              <th>Unprovided</th>
            </tr>
          </thead>
          <tbody>
            {eosb.map((row) => (
              <tr key={row.employeeId}>
                <td>
                  {row.code} — {row.nameEn}
                </td>
                <td>{new Date(row.joinDate).toLocaleDateString()}</td>
                <td>{Number(row.serviceYears).toFixed(2)}</td>
                <td>{Number(row.eosbWage).toFixed(2)}</td>
                <td>{Number(row.entitlementToDate).toFixed(2)}</td>
                <td>{Number(row.provisionBooked).toFixed(2)}</td>
                <td>{(Number(row.entitlementToDate) - Number(row.provisionBooked)).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Leave Balances</h2>
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Entitlement (days/yr)</th>
              <th>Accrued</th>
              <th>Taken</th>
              <th>Balance</th>
              <th>Provision value</th>
              <th>Provision booked</th>
            </tr>
          </thead>
          <tbody>
            {leave.map((row) => (
              <tr key={row.employeeId}>
                <td>
                  {row.code} — {row.nameEn}
                </td>
                <td>{Number(row.annualLeaveDays)}</td>
                <td>{Number(row.accruedDays).toFixed(2)}</td>
                <td>{Number(row.takenDays).toFixed(2)}</td>
                <td>{Number(row.balanceDays).toFixed(2)}</td>
                <td>{Number(row.provisionValue).toFixed(2)}</td>
                <td>{Number(row.provisionBooked).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
