import { FormEvent, useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiClient } from "../api/client";

interface WbsTask {
  id: string;
  code: string;
  name: string;
  parentTaskId: string | null;
  costBudget: string;
  isActive: boolean;
}

interface RevRecRun {
  id: string;
  runDate: string;
  percentComplete: string;
  cumulativeRevenue: string;
  recognizedThisRun: string;
  status: string;
  fiscalPeriod: { periodNumber: number; startDate: string; endDate: string };
}

interface ProjectDetail {
  id: string;
  code: string;
  name: string;
  status: string;
  recognitionMethod: string;
  contractValue: string;
  estimatedTotalCost: string;
  costCenter: { code: string };
  businessPartner: { code: string; name: string } | null;
  tasks: WbsTask[];
  revenueRecognitionRuns: RevRecRun[];
}

interface CostBreakdownRow {
  code: string;
  name: string;
  amount: string;
}

interface CostBreakdown {
  totalCosts: string;
  pendingAmount: string;
  paidAmount: string;
  byAccount: CostBreakdownRow[];
}

interface FiscalPeriod {
  id: string;
  periodNumber: number;
  startDate: string;
  endDate: string;
  status: string;
}

const NEXT_STATUS: Record<string, string[]> = {
  PLANNED: ["ACTIVE"],
  ACTIVE: ["COMPLETED", "CLOSED"],
  COMPLETED: ["ACTIVE", "CLOSED"],
  CLOSED: [],
};

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [taskForm, setTaskForm] = useState({ code: "", name: "", parentTaskId: "", costBudget: "" });
  const [estimates, setEstimates] = useState({ name: "", contractValue: "", estimatedTotalCost: "" });
  const [costBreakdown, setCostBreakdown] = useState<CostBreakdown | null>(null);

  const load = useCallback(async () => {
    const [projectRes, periodsRes, breakdownRes] = await Promise.all([
      apiClient.get<ProjectDetail>(`/projects/${id}`),
      apiClient.get<FiscalPeriod[]>("/companies/current/fiscal-periods"),
      apiClient.get<CostBreakdown>(`/projects/${id}/cost-breakdown`),
    ]);
    setProject(projectRes.data);
    setPeriods(periodsRes.data);
    setCostBreakdown(breakdownRes.data);
    setEstimates({
      name: projectRes.data.name,
      contractValue: projectRes.data.contractValue,
      estimatedTotalCost: projectRes.data.estimatedTotalCost,
    });
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function transition(status: string) {
    setError(null);
    setBusy(true);
    try {
      await apiClient.post(`/projects/${id}/status`, { status });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Transition failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveEstimates(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiClient.patch(`/projects/${id}`, estimates);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function addTask(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiClient.post(`/projects/${id}/tasks`, {
        code: taskForm.code,
        name: taskForm.name,
        parentTaskId: taskForm.parentTaskId || undefined,
        costBudget: taskForm.costBudget || undefined,
      });
      setTaskForm({ code: "", name: "", parentTaskId: "", costBudget: "" });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Task creation failed");
    } finally {
      setBusy(false);
    }
  }

  async function runRevRec() {
    if (!selectedPeriodId) return;
    setError(null);
    setBusy(true);
    try {
      await apiClient.post(`/projects/${id}/revenue-recognition/run`, { fiscalPeriodId: selectedPeriodId });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Revenue recognition failed");
    } finally {
      setBusy(false);
    }
  }

  async function reverseRun(runId: string) {
    setError(null);
    setBusy(true);
    try {
      await apiClient.post(`/projects/${id}/revenue-recognition/runs/${runId}/reverse`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Reversal failed");
    } finally {
      setBusy(false);
    }
  }

  /** Render tasks as an indented tree (roots first, DFS). */
  function taskTree(): Array<WbsTask & { depth: number }> {
    if (!project) return [];
    const byParent = new Map<string | null, WbsTask[]>();
    for (const task of project.tasks) {
      const list = byParent.get(task.parentTaskId) ?? [];
      list.push(task);
      byParent.set(task.parentTaskId, list);
    }
    const out: Array<WbsTask & { depth: number }> = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const task of byParent.get(parentId) ?? []) {
        out.push({ ...task, depth });
        walk(task.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }

  if (!project) return <p style={{ padding: 24 }}>Loading…</p>;

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>{project.code}</h2>
          <span>
            <span className={`badge ${project.status === "ACTIVE" ? "posted" : project.status === "CLOSED" ? "reversed" : "draft"}`}>
              {project.status}
            </span>{" "}
            {NEXT_STATUS[project.status]?.map((s) => (
              <button key={s} className="secondary" disabled={busy} onClick={() => transition(s)}>
                → {s}
              </button>
            ))}
          </span>
        </div>
        <p>
          Cost center <strong>{project.costCenter.code}</strong>
          {project.businessPartner && (
            <>
              {" · "}Customer <strong>{project.businessPartner.name}</strong>
            </>
          )}
          {" · "}
          {project.recognitionMethod === "OVER_TIME" ? "Over-time (POC) recognition" : "Point-in-time recognition"}
        </p>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={saveEstimates} className="form-row">
          <label>Name </label>
          <input
            value={estimates.name}
            onChange={(e) => setEstimates({ ...estimates, name: e.target.value })}
            style={{ flex: 1 }}
            disabled={project.status === "CLOSED"}
          />
          <label>Contract </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={estimates.contractValue}
            onChange={(e) => setEstimates({ ...estimates, contractValue: e.target.value })}
            style={{ width: 140 }}
          />
          <label>Est. total cost </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={estimates.estimatedTotalCost}
            onChange={(e) => setEstimates({ ...estimates, estimatedTotalCost: e.target.value })}
            style={{ width: 140 }}
          />
          <button type="submit" disabled={busy || project.status === "CLOSED"}>
            Save estimates
          </button>
        </form>
      </div>

      {costBreakdown && (
        <div className="card">
          <h3>Cost breakdown (real, from posted purchase invoices &amp; GL)</h3>
          <div className="form-row">
            <div className="kpi-tile">
              <div>Total Costs</div>
              <strong>{Number(costBreakdown.totalCosts).toFixed(2)}</strong>
            </div>
            <div className="kpi-tile">
              <div>Paid</div>
              <strong>{Number(costBreakdown.paidAmount).toFixed(2)}</strong>
            </div>
            <div className="kpi-tile">
              <div>Pending (yet to be paid)</div>
              <strong>{Number(costBreakdown.pendingAmount).toFixed(2)}</strong>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {costBreakdown.byAccount.map((row) => (
                <tr key={row.code}>
                  <td>
                    {row.code} — {row.name}
                  </td>
                  <td>{Number(row.amount).toFixed(2)}</td>
                </tr>
              ))}
              {costBreakdown.byAccount.length === 0 && (
                <tr>
                  <td colSpan={2} style={{ color: "#98a2b3" }}>
                    No posted costs yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h3>WBS tasks</h3>
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Budget</th>
            </tr>
          </thead>
          <tbody>
            {taskTree().map((t) => (
              <tr key={t.id} style={{ opacity: t.isActive ? 1 : 0.5 }}>
                <td style={{ paddingLeft: 12 + t.depth * 24 }}>{t.code}</td>
                <td>{t.name}</td>
                <td>{Number(t.costBudget).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <form onSubmit={addTask} className="form-row" style={{ marginTop: 8 }}>
          <input placeholder="Code" value={taskForm.code} onChange={(e) => setTaskForm({ ...taskForm, code: e.target.value })} required style={{ width: 90 }} />
          <input placeholder="Name" value={taskForm.name} onChange={(e) => setTaskForm({ ...taskForm, name: e.target.value })} required style={{ flex: 1 }} />
          <select value={taskForm.parentTaskId} onChange={(e) => setTaskForm({ ...taskForm, parentTaskId: e.target.value })}>
            <option value="">(root task)</option>
            {project.tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.code}
              </option>
            ))}
          </select>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Budget"
            value={taskForm.costBudget}
            onChange={(e) => setTaskForm({ ...taskForm, costBudget: e.target.value })}
            style={{ width: 110 }}
          />
          <button type="submit" disabled={busy || project.status === "CLOSED"}>
            Add task
          </button>
        </form>
      </div>

      {project.recognitionMethod === "OVER_TIME" && (
        <div className="card">
          <h3>Revenue recognition (POC)</h3>
          <div className="form-row">
            <select value={selectedPeriodId} onChange={(e) => setSelectedPeriodId(e.target.value)}>
              <option value="" disabled>
                Select fiscal period…
              </option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  Period {p.periodNumber} ({new Date(p.startDate).toLocaleDateString()} – {new Date(p.endDate).toLocaleDateString()})
                </option>
              ))}
            </select>
            <button onClick={runRevRec} disabled={busy || !selectedPeriodId}>
              {busy ? "Running…" : "Run recognition"}
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Period</th>
                <th>Run Date</th>
                <th>POC</th>
                <th>Cumulative Revenue</th>
                <th>Recognized This Run</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {project.revenueRecognitionRuns.map((run) => (
                <tr key={run.id}>
                  <td>P{run.fiscalPeriod.periodNumber}</td>
                  <td>{new Date(run.runDate).toLocaleDateString()}</td>
                  <td>{(Number(run.percentComplete) * 100).toFixed(2)}%</td>
                  <td>{Number(run.cumulativeRevenue).toFixed(2)}</td>
                  <td>{Number(run.recognizedThisRun).toFixed(2)}</td>
                  <td>
                    <span className={`badge ${run.status === "POSTED" ? "posted" : "reversed"}`}>{run.status}</span>
                  </td>
                  <td>
                    {run.status === "POSTED" && (
                      <button className="secondary" disabled={busy} onClick={() => reverseRun(run.id)}>
                        Reverse
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
