import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiClient } from "../api/client";

interface PayrollRun {
  id: string;
  runNumber: string | null;
  status: string;
  runDate: string;
  totalGross: string;
  totalNetPay: string;
  fiscalPeriod: { periodNumber: number; startDate: string; endDate: string };
  _count: { lines: number };
}

interface FiscalPeriod {
  id: string;
  periodNumber: number;
  startDate: string;
  endDate: string;
  status: string;
}

export function PayrollRunsPage() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [runsRes, periodsRes] = await Promise.all([
        apiClient.get<PayrollRun[]>("/hr/payroll-runs"),
        apiClient.get<FiscalPeriod[]>("/companies/current/fiscal-periods"),
      ]);
      setRuns(runsRes.data);
      setPeriods(periodsRes.data.filter((p) => p.status !== "CLOSED"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createRun() {
    if (!selectedPeriodId) return;
    setError(null);
    setCreating(true);
    try {
      const res = await apiClient.post("/hr/payroll-runs", { fiscalPeriodId: selectedPeriodId });
      navigate(`/hr/payroll-runs/${res.data.id}`);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create run");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="card">
      <h2>Payroll Runs</h2>
      {error && <div className="error-banner">{error}</div>}
      <div className="form-row">
        <select value={selectedPeriodId} onChange={(e) => setSelectedPeriodId(e.target.value)}>
          <option value="" disabled>
            Select fiscal period…
          </option>
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              Period {p.periodNumber} ({new Date(p.startDate).toLocaleDateString()} –{" "}
              {new Date(p.endDate).toLocaleDateString()})
            </option>
          ))}
        </select>
        <button onClick={createRun} disabled={creating || !selectedPeriodId}>
          {creating ? "Computing…" : "New payroll run"}
        </button>
      </div>
      {loading ? (
        <p>Loading…</p>
      ) : runs.length === 0 ? (
        <p>No payroll runs yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Number</th>
              <th>Period</th>
              <th>Employees</th>
              <th>Gross</th>
              <th>Net pay</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td>
                  <Link to={`/hr/payroll-runs/${run.id}`}>{run.runNumber ?? "(draft)"}</Link>
                </td>
                <td>P{run.fiscalPeriod.periodNumber}</td>
                <td>{run._count.lines}</td>
                <td>{Number(run.totalGross).toFixed(2)}</td>
                <td>{Number(run.totalNetPay).toFixed(2)}</td>
                <td>
                  <span
                    className={`badge ${run.status === "POSTED" ? "posted" : run.status === "REVERSED" ? "reversed" : "draft"}`}
                  >
                    {run.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
