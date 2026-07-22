import { useCallback, useEffect, useState } from "react";
import { apiClient } from "../api/client";

interface RunLine {
  id: string;
  amount: string;
  accumulatedAfter: string;
  nbvAfter: string;
  equipment: { code: string; name: string };
  costCenter: { code: string } | null;
}

interface DepreciationRun {
  id: string;
  runNumber: string;
  status: string;
  totalAmount: string;
  createdAt: string;
  fiscalPeriod: { periodNumber: number; startDate: string; endDate: string };
  lines: RunLine[];
}

interface FiscalPeriod {
  id: string;
  periodNumber: number;
  startDate: string;
  endDate: string;
  status: string;
}

export function DepreciationRunsPage() {
  const [runs, setRuns] = useState<DepreciationRun[]>([]);
  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [runsRes, periodsRes] = await Promise.all([
        apiClient.get<DepreciationRun[]>("/equipment/depreciation-runs"),
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

  async function runDepreciation() {
    if (!selectedPeriodId) return;
    setError(null);
    setBusy(true);
    try {
      await apiClient.post("/equipment/depreciation-runs", { fiscalPeriodId: selectedPeriodId });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Depreciation run failed");
    } finally {
      setBusy(false);
    }
  }

  async function reverseRun(runId: string) {
    if (!window.confirm("Reverse this depreciation run?")) return;
    setError(null);
    setBusy(true);
    try {
      await apiClient.post(`/equipment/depreciation-runs/${runId}/reverse`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Reverse failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Depreciation Runs</h2>
      <p style={{ color: "#667085", fontSize: 13 }}>
        Straight-line monthly depreciation posted to the GL (Dr 5230 / Cr 1519). Units on rent are charged to their
        contract's cost center. Run periods in order; reverse the latest run to correct.
      </p>
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
        <button onClick={runDepreciation} disabled={busy || !selectedPeriodId}>
          {busy ? "Running…" : "Run depreciation"}
        </button>
      </div>
      {loading ? (
        <p>Loading…</p>
      ) : runs.length === 0 ? (
        <p>No depreciation runs yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Number</th>
              <th>Period</th>
              <th>Units</th>
              <th>Total</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <>
                <tr key={run.id}>
                  <td>{run.runNumber}</td>
                  <td>P{run.fiscalPeriod.periodNumber}</td>
                  <td>{run.lines.length}</td>
                  <td>{Number(run.totalAmount).toFixed(2)}</td>
                  <td>
                    <span className={`badge ${run.status === "POSTED" ? "posted" : "reversed"}`}>{run.status}</span>
                  </td>
                  <td>
                    <button className="secondary" onClick={() => setExpanded(expanded === run.id ? null : run.id)}>
                      {expanded === run.id ? "Hide" : "Lines"}
                    </button>{" "}
                    {run.status === "POSTED" && (
                      <button className="secondary" onClick={() => reverseRun(run.id)} disabled={busy}>
                        Reverse
                      </button>
                    )}
                  </td>
                </tr>
                {expanded === run.id &&
                  run.lines.map((line) => (
                    <tr key={line.id} style={{ background: "#f8f9fb" }}>
                      <td style={{ paddingLeft: 32 }} colSpan={2}>
                        {line.equipment.code} — {line.equipment.name}
                      </td>
                      <td>CC: {line.costCenter?.code ?? "—"}</td>
                      <td>{Number(line.amount).toFixed(2)}</td>
                      <td colSpan={2}>
                        Accum: {Number(line.accumulatedAfter).toFixed(2)} · NBV: {Number(line.nbvAfter).toFixed(2)}
                      </td>
                    </tr>
                  ))}
              </>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
