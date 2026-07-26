import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
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
  costCenter: { id: string; code: string; name: string };
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

interface IntelligenceAccountRow {
  id: string;
  code: string;
  name: string;
  amount: string;
}

interface IntelligenceSummary {
  categories: Record<"MATERIAL" | "MACHINERY" | "LABOR" | "OTHER", { total: string; accounts: IntelligenceAccountRow[] }>;
  grandTotal: string;
}

interface FiscalPeriod {
  id: string;
  periodNumber: number;
  startDate: string;
  endDate: string;
  status: string;
}

function formatMoney(value: string | number | undefined | null): string {
  return Number(value ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  const [intelligence, setIntelligence] = useState<IntelligenceSummary | null>(null);
  const [costCenterForm, setCostCenterForm] = useState({ code: "", name: "" });

  const load = useCallback(async () => {
    const [projectRes, periodsRes, breakdownRes, intelligenceRes] = await Promise.all([
      apiClient.get<ProjectDetail>(`/projects/${id}`),
      apiClient.get<FiscalPeriod[]>("/companies/current/fiscal-periods"),
      apiClient.get<CostBreakdown>(`/projects/${id}/cost-breakdown`),
      apiClient.get<IntelligenceSummary>(`/projects/${id}/intelligence`),
    ]);
    setProject(projectRes.data);
    setPeriods(periodsRes.data);
    setCostBreakdown(breakdownRes.data);
    setIntelligence(intelligenceRes.data);
    setEstimates({
      name: projectRes.data.name,
      contractValue: projectRes.data.contractValue,
      estimatedTotalCost: projectRes.data.estimatedTotalCost,
    });
    setCostCenterForm({ code: projectRes.data.costCenter.code, name: projectRes.data.costCenter.name });
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

  async function saveCostCenter(e: FormEvent) {
    e.preventDefault();
    if (!project) return;
    setError(null);
    setBusy(true);
    try {
      await apiClient.patch(`/cost-centers/${project.costCenter.id}`, costCenterForm);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Cost center update failed");
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
          {project.businessPartner && (
            <>
              Customer <strong>{project.businessPartner.name}</strong>
              {" · "}
            </>
          )}
          {project.recognitionMethod === "OVER_TIME" ? "Over-time (POC) recognition" : "Point-in-time recognition"}
        </p>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={saveCostCenter} className="form-row">
          <label>Cost center code </label>
          <input
            value={costCenterForm.code}
            onChange={(e) => setCostCenterForm({ ...costCenterForm, code: e.target.value })}
            style={{ width: 140 }}
          />
          <label>Cost center name </label>
          <input
            value={costCenterForm.name}
            onChange={(e) => setCostCenterForm({ ...costCenterForm, name: e.target.value })}
            style={{ flex: 1 }}
          />
          <button type="submit" disabled={busy}>
            Save cost center
          </button>
        </form>
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

      {intelligence && (
        <div className="intelligence-board">
          <div className="intelligence-header">
            <div>
              <div className="intelligence-title">Project Intelligence</div>
              <div className="intelligence-subtitle">Live cost breakdown across every purchase invoice and payroll posting for this project</div>
            </div>
          </div>

          <div className="pi-kpi-strip">
            <div className="pi-kpi-card">
              <div className="pi-kpi-label">Total Cost</div>
              <div className="pi-kpi-value">{formatMoney(intelligence.grandTotal)}</div>
            </div>
            <div className="pi-kpi-card">
              <div className="pi-kpi-label">Material Cost</div>
              <div className="pi-kpi-value">{formatMoney(intelligence.categories.MATERIAL?.total)}</div>
            </div>
            <div className="pi-kpi-card">
              <div className="pi-kpi-label">Machinery Cost</div>
              <div className="pi-kpi-value">{formatMoney(intelligence.categories.MACHINERY?.total)}</div>
            </div>
            <div className="pi-kpi-card">
              <div className="pi-kpi-label">Labor Cost</div>
              <div className="pi-kpi-value">{formatMoney(intelligence.categories.LABOR?.total)}</div>
            </div>
            <div className="pi-kpi-card">
              <div className="pi-kpi-label">Contract Value</div>
              <div className="pi-kpi-value accent-blue">{formatMoney(project.contractValue)}</div>
            </div>
          </div>

          <div className="pi-chart-card">
            <h3>Cost by category</h3>
            {(() => {
              const cats = ["MATERIAL", "MACHINERY", "LABOR", "OTHER"] as const;
              const values = cats.map((c) => Number(intelligence.categories[c]?.total ?? 0));
              const max = Math.max(1, ...values);
              const labels: Record<(typeof cats)[number], string> = {
                MATERIAL: "Material",
                MACHINERY: "Machinery",
                LABOR: "Labor",
                OTHER: "Other",
              };
              return cats.map((c, i) => (
                <Link key={c} to={`/projects/${id}/costs/${c.toLowerCase()}`} className="pi-bar-row">
                  <div className="pi-bar-label">{labels[c]}</div>
                  <div className="pi-bar-track">
                    <div className={`pi-bar-fill ${c.toLowerCase()}`} style={{ width: `${(values[i] / max) * 100}%` }} />
                  </div>
                  <div className="pi-bar-value">{formatMoney(values[i])}</div>
                </Link>
              ));
            })()}
          </div>

          <div className="pi-tables-grid">
            {(["MATERIAL", "MACHINERY", "LABOR"] as const).map((cat) => {
              const bucket = intelligence.categories[cat];
              const label = cat === "MATERIAL" ? "Material Cost by Account" : cat === "MACHINERY" ? "Machinery Cost by Account" : "Labor Cost by Account";
              return (
                <div key={cat} className={`pi-table-card ${cat.toLowerCase()}`}>
                  <h4>
                    <span>{label}</span>
                    <span className="total">{formatMoney(bucket?.total)}</span>
                  </h4>
                  <table>
                    <tbody>
                      {(bucket?.accounts ?? [])
                        .slice()
                        .sort((a, b) => Number(b.amount) - Number(a.amount))
                        .map((a) => (
                          <tr key={a.id}>
                            <td>
                              {a.code} — {a.name}
                            </td>
                            <td style={{ textAlign: "right", fontWeight: 600 }}>{formatMoney(a.amount)}</td>
                          </tr>
                        ))}
                      {(!bucket || bucket.accounts.length === 0) && (
                        <tr>
                          <td style={{ color: "#98a2b3" }}>No costs recorded yet</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
