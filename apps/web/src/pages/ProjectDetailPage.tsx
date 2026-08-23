import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiClient } from "../api/client";
import { downloadCsv } from "../utils/csv";
import { downloadPdf } from "../utils/pdf";
import { useAuth } from "../auth/AuthContext";

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
  startDate: string | null;
  contractValue: string;
  estimatedTotalCost: string;
  currentPhase: string | null;
  natureOfWork: string | null;
  costCenter: { id: string; code: string; name: string };
  businessPartner: { code: string; name: string } | null;
  tasks: WbsTask[];
  revenueRecognitionRuns: RevRecRun[];
}

const PROJECT_PHASES = ["Mobilization", "Design & Procurement", "Execution", "Finishing", "Handover"] as const;

interface IntelligenceAccountRow {
  id: string;
  code: string;
  name: string;
  amount: string;
}

interface IntelligenceSummary {
  categories: Record<
    "MATERIAL" | "MACHINERY" | "LABOR" | "OTHER",
    { total: string; paid: string; pending: string; accounts: IntelligenceAccountRow[] }
  >;
  grandTotal: string;
}

interface MonthlyCostTrendRow {
  month: string;
  materialCost: string;
  machineryCost: string;
  laborCost: string;
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

function formatCompact(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return (k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)) + "K";
  }
  return String(Math.round(n));
}

function formatMonthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

const TREND_SERIES = [
  { key: "materialCost", name: "Material", color: "#2a78d6" },
  { key: "machineryCost", name: "Machinery", color: "#eb6834" },
  { key: "laborCost", name: "Labor", color: "#1baf7a" },
] as const;

/**
 * Month-wise clustered columns for Material/Machinery/Labor — approved
 * design: same color per category across every month, cost above each
 * bar, category name below each bar, month name below the group of
 * three. Each bar is a single incurred total (paid + pending combined),
 * not split — matches the approved chart-approval artifact exactly.
 */
function MonthlyCostTrendChart({ rows }: { rows: MonthlyCostTrendRow[] }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string; value: string } | null>(null);

  if (rows.length === 0) {
    return <p style={{ color: "#98a2b3", fontSize: 13 }}>No Material/Machinery/Labor cost recorded yet.</p>;
  }

  const barW = 34;
  const barGap = 34;
  const groupGap = 58;
  const groupW = barW * 3 + barGap * 2;
  const padL = 50;
  const padR = 24;
  const padT = 66;
  const padB = 58;
  const plotW = rows.length * groupW + (rows.length - 1) * groupGap;
  const H = 400;
  const plotH = H - padT - padB;
  const W = padL + plotW + padR;

  let maxVal = 0;
  rows.forEach((r) => {
    maxVal = Math.max(maxVal, Number(r.materialCost), Number(r.machineryCost), Number(r.laborCost));
  });
  const niceMax = Math.max(25000, Math.ceil(maxVal / 25000) * 25000);

  const y = (v: number) => padT + plotH - (v / niceMax) * plotH;
  const h = (v: number) => (v / niceMax) * plotH;

  const steps = 4;
  const gridLines = Array.from({ length: steps + 1 }, (_, s) => {
    const val = (niceMax / steps) * s;
    return { val, gy: y(val) };
  });

  const total = rows.reduce(
    (sum, r) => sum + Number(r.materialCost) + Number(r.machineryCost) + Number(r.laborCost),
    0,
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {TREND_SERIES.map((s) => (
            <span key={s.key} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 500, color: "#475467" }}>
              <span style={{ width: 11, height: 11, borderRadius: 3, background: s.color, display: "inline-block" }} />
              {s.name}
            </span>
          ))}
        </div>
        <span style={{ fontFamily: "inherit", fontWeight: 700, fontSize: 12.5, background: "rgba(42,120,214,0.12)", color: "#2a78d6", padding: "5px 10px", borderRadius: 6 }}>
          Total {formatMoney(total)}
        </span>
      </div>
      <div style={{ overflowX: "auto", position: "relative" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: "block", overflow: "visible" }}>
          {gridLines.map((g, i) => (
            <g key={i}>
              {i % 2 === 1 && (
                <rect x={padL} y={y((niceMax / steps) * (i + 1))} width={plotW} height={plotH / steps} fill="#e1e0d9" opacity={0.35} />
              )}
              <line x1={padL} y1={g.gy} x2={padL + plotW} y2={g.gy} stroke="#e1e0d9" strokeWidth={1} />
              <text x={padL - 10} y={g.gy + 3} textAnchor="end" fontSize={10.5} fill="#898781" style={{ fontVariantNumeric: "tabular-nums" }}>
                {formatCompact(g.val)}
              </text>
            </g>
          ))}

          {rows.map((r, mi) => {
            const gx = padL + mi * (groupW + groupGap);
            const gcx = gx + groupW / 2;
            const monthTotal = Number(r.materialCost) + Number(r.machineryCost) + Number(r.laborCost);
            const totalText = `SAR ${formatCompact(monthTotal)}`;
            const badgeW = Math.max(64, totalText.length * 7.4 + 20);
            return (
              <g key={r.month}>
                {mi > 0 && (
                  <line x1={gx - groupGap / 2} y1={padT} x2={gx - groupGap / 2} y2={padT + plotH} stroke="rgba(11,11,11,0.1)" strokeWidth={1} strokeDasharray="2 3" />
                )}
                <rect x={gcx - badgeW / 2} y={padT - 40} width={badgeW} height={22} rx={6} fill="#fcfcfb" stroke="rgba(11,11,11,0.1)" strokeWidth={1} />
                <text x={gcx} y={padT - 25} textAnchor="middle" fontSize={13} fontWeight={800} fill="#2a78d6" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {totalText}
                </text>
                {TREND_SERIES.map((s, si) => {
                  const val = Number(r[s.key as keyof MonthlyCostTrendRow]);
                  const x = gx + si * (barW + barGap);
                  const yy = y(val);
                  const hh = h(val);
                  const rad = 4;
                  const d = `M${x},${yy + hh} L${x},${yy + rad} Q${x},${yy} ${x + rad},${yy} L${x + barW - rad},${yy} Q${x + barW},${yy} ${x + barW},${yy + rad} L${x + barW},${yy + hh} Z`;
                  return (
                    <g key={s.key}>
                      <path
                        d={d}
                        fill={s.color}
                        style={{ cursor: "pointer" }}
                        onMouseMove={(e) =>
                          setTooltip({ x: e.clientX + 14, y: e.clientY + 14, label: `${s.name} — ${formatMonthLabel(r.month)}`, value: formatMoney(val) })
                        }
                        onMouseLeave={() => setTooltip(null)}
                      />
                      <text x={x + barW / 2} y={yy - 8} textAnchor="middle" fontSize={12.5} fontWeight={700} fill="#0b0b0b" style={{ fontVariantNumeric: "tabular-nums" }}>
                        {formatCompact(val)}
                      </text>
                      <text x={x + barW / 2} y={padT + plotH + 18} textAnchor="middle" fontSize={11.5} fontWeight={600} fill="#475467">
                        {s.name}
                      </text>
                    </g>
                  );
                })}
                <text x={gcx} y={padT + plotH + 40} textAnchor="middle" fontSize={13} fontWeight={700} fill="#0b0b0b">
                  {formatMonthLabel(r.month)}
                </text>
              </g>
            );
          })}

          <line x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH} stroke="#c3c2b7" strokeWidth={1} />
        </svg>
      </div>
      {tooltip && (
        <div
          style={{
            position: "fixed",
            left: tooltip.x,
            top: tooltip.y,
            pointerEvents: "none",
            background: "#101828",
            color: "#fff",
            fontSize: 12,
            lineHeight: 1.5,
            padding: "8px 11px",
            borderRadius: 6,
            boxShadow: "0 4px 16px rgba(16,24,40,0.24)",
            zIndex: 50,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 3 }}>{tooltip.label}</div>
          <div style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{tooltip.value}</div>
        </div>
      )}
    </div>
  );
}

const NEXT_STATUS: Record<string, string[]> = {
  PLANNED: ["ACTIVE"],
  ACTIVE: ["COMPLETED", "CLOSED"],
  COMPLETED: ["ACTIVE", "CLOSED"],
  CLOSED: [],
};

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [taskForm, setTaskForm] = useState({ code: "", name: "", parentTaskId: "", costBudget: "" });
  const [estimates, setEstimates] = useState({ code: "", name: "", contractValue: "", estimatedTotalCost: "" });
  const [intelligence, setIntelligence] = useState<IntelligenceSummary | null>(null);
  const [monthlyTrend, setMonthlyTrend] = useState<MonthlyCostTrendRow[] | null>(null);
  const [costCenterForm, setCostCenterForm] = useState({ code: "", name: "" });
  const [phaseForm, setPhaseForm] = useState({ startDate: "", currentPhase: "", natureOfWork: "" });
  const { user } = useAuth();
  const isAdministrator = user?.roleName === "Administrator";

  const load = useCallback(async () => {
    const [projectRes, periodsRes, intelligenceRes, trendRes] = await Promise.all([
      apiClient.get<ProjectDetail>(`/projects/${id}`),
      apiClient.get<FiscalPeriod[]>("/companies/current/fiscal-periods"),
      apiClient.get<IntelligenceSummary>(`/projects/${id}/intelligence`),
      apiClient.get<{ rows: MonthlyCostTrendRow[] }>(`/projects/${id}/monthly-cost-trend`),
    ]);
    setProject(projectRes.data);
    setPeriods(periodsRes.data);
    setIntelligence(intelligenceRes.data);
    setMonthlyTrend(trendRes.data.rows);
    setEstimates({
      code: projectRes.data.code,
      name: projectRes.data.name,
      contractValue: projectRes.data.contractValue,
      estimatedTotalCost: projectRes.data.estimatedTotalCost,
    });
    setCostCenterForm({ code: projectRes.data.costCenter.code, name: projectRes.data.costCenter.name });
    setPhaseForm({
      startDate: projectRes.data.startDate ? projectRes.data.startDate.slice(0, 10) : "",
      currentPhase: projectRes.data.currentPhase ?? "",
      natureOfWork: projectRes.data.natureOfWork ?? "",
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

  async function savePhase(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiClient.patch(`/projects/${id}`, {
        startDate: phaseForm.startDate ? new Date(phaseForm.startDate).toISOString() : undefined,
        currentPhase: phaseForm.currentPhase || undefined,
        natureOfWork: phaseForm.natureOfWork || undefined,
      });
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

  function downloadIntelligenceCsv() {
    if (!intelligence || !project) return;
    const cats = ["MATERIAL", "MACHINERY", "LABOR"] as const;
    const rows: Array<Array<string | number>> = [];
    let total = 0;
    for (const cat of cats) {
      const bucket = intelligence.categories[cat];
      if (!bucket) continue;
      for (const account of bucket.accounts) {
        rows.push([cat, account.code, account.name, Number(account.amount).toFixed(2)]);
      }
      rows.push([cat, "", "Category total", Number(bucket.total).toFixed(2)]);
      total += Number(bucket.total);
    }
    rows.push(["", "", "Grand total (all costs)", total.toFixed(2)]);
    rows.push(["", "", "Contract value", Number(project.contractValue).toFixed(2)]);
    downloadCsv(`${project.code}-project-intelligence.csv`, ["Category", "Account code", "Account name", "Amount (SAR, gross of VAT)"], rows);
  }

  function downloadIntelligencePdf() {
    if (!intelligence || !project) return;
    const cats = ["MATERIAL", "MACHINERY", "LABOR"] as const;
    const labels: Record<(typeof cats)[number], string> = {
      MATERIAL: "Material",
      MACHINERY: "Machinery",
      LABOR: "Labor",
    };
    const rows: Array<Array<string | number>> = [];
    let total = 0;
    for (const cat of cats) {
      const bucket = intelligence.categories[cat];
      if (!bucket) continue;
      total += Number(bucket.total);
      for (const account of bucket.accounts) {
        rows.push([labels[cat], `${account.code} — ${account.name}`, formatMoney(account.amount)]);
      }
    }
    downloadPdf(`${project.code}-project-intelligence.pdf`, `Project Intelligence — ${project.code} (${project.name})`, [
      {
        heading: "Summary (amounts gross of VAT — the real amount paid/payable to vendors)",
        kpis: [
          { label: "Total cost", value: formatMoney(total) },
          { label: "Material cost", value: formatMoney(intelligence.categories.MATERIAL?.total) },
          { label: "Machinery cost", value: formatMoney(intelligence.categories.MACHINERY?.total) },
          { label: "Labor cost", value: formatMoney(intelligence.categories.LABOR?.total) },
          { label: "Contract value", value: formatMoney(project.contractValue) },
        ],
      },
      {
        heading: "Cost by account",
        headers: ["Category", "Account", "Amount (SAR)"],
        rows,
      },
    ]);
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
          <label>Code </label>
          <input
            value={estimates.code}
            onChange={(e) => setEstimates({ ...estimates, code: e.target.value })}
            style={{ width: 160 }}
            disabled={project.status === "CLOSED"}
          />
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
              <div className="intelligence-subtitle">
                Live cost breakdown across every purchase invoice and payroll posting for this project — amounts are
                gross of VAT (the real amount paid/payable to vendors)
              </div>
            </div>
            <div className="button-group">
              <button className="secondary" onClick={downloadIntelligenceCsv}>
                Download (CSV)
              </button>
              <button className="secondary" onClick={downloadIntelligencePdf}>
                Download (PDF)
              </button>
            </div>
          </div>

          <div className="pi-kpi-strip">
            <div className="pi-kpi-card">
              <div className="pi-kpi-label">Total Cost</div>
              <div className="pi-kpi-value">
                {formatMoney(
                  Number(intelligence.categories.MATERIAL?.total ?? 0) +
                    Number(intelligence.categories.MACHINERY?.total ?? 0) +
                    Number(intelligence.categories.LABOR?.total ?? 0),
                )}
              </div>
            </div>
            <div className="pi-kpi-card">
              <div className="pi-kpi-label">Material Cost</div>
              <div className="pi-kpi-value">{formatMoney(intelligence.categories.MATERIAL?.total)}</div>
            </div>
            <div className="pi-kpi-card">
              <div className="pi-kpi-label">Machinery Cost</div>
              <div className="pi-kpi-value">{formatMoney(intelligence.categories.MACHINERY?.total)}</div>
              <div style={{ fontSize: 11, color: "#98a2b3", marginTop: 4 }}>
                Paid {formatMoney(intelligence.categories.MACHINERY?.paid)} · Pending{" "}
                {formatMoney(intelligence.categories.MACHINERY?.pending)}
              </div>
            </div>
            <div className="pi-kpi-card">
              <div className="pi-kpi-label">Labor Cost</div>
              <div className="pi-kpi-value">{formatMoney(intelligence.categories.LABOR?.total)}</div>
              <div style={{ fontSize: 11, color: "#98a2b3", marginTop: 4 }}>
                Paid {formatMoney(intelligence.categories.LABOR?.paid)} · Pending {formatMoney(intelligence.categories.LABOR?.pending)}
              </div>
            </div>
            <div className="pi-kpi-card">
              <div className="pi-kpi-label">Contract Value</div>
              <div className="pi-kpi-value accent-blue">{formatMoney(project.contractValue)}</div>
            </div>
          </div>

          <div className="pi-chart-card">
            <h3>Cost by category</h3>
            {(() => {
              const cats = ["MATERIAL", "MACHINERY", "LABOR"] as const;
              const values = cats.map((c) => Number(intelligence.categories[c]?.total ?? 0));
              const max = Math.max(1, ...values);
              const labels: Record<(typeof cats)[number], string> = {
                MATERIAL: "Material",
                MACHINERY: "Machinery",
                LABOR: "Labor",
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

          <div className="pi-chart-card">
            <h3>Monthly cost — Material, Machinery, Labor</h3>
            {monthlyTrend ? <MonthlyCostTrendChart rows={monthlyTrend} /> : <p style={{ color: "#98a2b3", fontSize: 13 }}>Loading…</p>}
          </div>

          <div className="pi-tables-grid">
            {(["MATERIAL", "MACHINERY", "LABOR"] as const).map((cat) => {
              const bucket = intelligence.categories[cat];
              const label = cat === "MATERIAL" ? "Material Cost by Account" : cat === "MACHINERY" ? "Machinery Cost by Account" : "Labor Cost by Account";
              return (
                <div key={cat} className={`pi-table-card ${cat.toLowerCase()}`}>
                  <h4>
                    <span>{label}</span>
                    <span className="total">{formatMoney(bucket?.paid)}</span>
                  </h4>
                  {cat === "LABOR" && Number(bucket?.pending ?? 0) > 0 && (
                    <div style={{ fontSize: 12, color: "#98a2b3", marginBottom: 8 }}>
                      + {formatMoney(bucket?.pending)} pending (accrued from timesheets, not yet paid)
                    </div>
                  )}
                  <table>
                    <tbody>
                      {(bucket?.accounts ?? [])
                        .slice()
                        .sort((a, b) => Number(b.amount) - Number(a.amount))
                        .map((a) => (
                          <tr
                            key={a.id}
                            className="pi-table-row-link"
                            onClick={() =>
                              navigate(
                                cat === "LABOR"
                                  ? `/projects/${id}/costs/labor?accountId=${a.id}`
                                  : `/projects/${id}/costs/accounts/${a.id}`,
                              )
                            }
                          >
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

      {isAdministrator && (
        <div className="card">
          <h3>Network diagram</h3>
          <p style={{ color: "#667085", fontSize: 13 }}>
            Execution-status overview — visible to Administrators only.
          </p>

          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0, margin: "16px 0" }}>
            {PROJECT_PHASES.map((phase, i) => {
              const isCurrent = (project.currentPhase ?? "").trim().toLowerCase() === phase.toLowerCase();
              return (
                <div key={phase} style={{ display: "flex", alignItems: "center" }}>
                  <div
                    style={{
                      padding: "10px 16px",
                      borderRadius: 8,
                      border: isCurrent ? "2px solid #1570ef" : "1px solid #d0d5dd",
                      background: isCurrent ? "#eff8ff" : "#fff",
                      color: isCurrent ? "#1570ef" : "#344054",
                      fontWeight: isCurrent ? 700 : 500,
                      fontSize: 13,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {phase}
                  </div>
                  {i < PROJECT_PHASES.length - 1 && (
                    <div style={{ padding: "0 8px", color: "#98a2b3", fontSize: 18 }}>→</div>
                  )}
                </div>
              );
            })}
          </div>

          {project.currentPhase && !PROJECT_PHASES.some((p) => p.toLowerCase() === project.currentPhase!.toLowerCase()) && (
            <p style={{ fontSize: 13, color: "#667085" }}>
              Current phase (custom): <strong>{project.currentPhase}</strong>
            </p>
          )}

          <div className="form-row" style={{ marginTop: 4 }}>
            <div className="kpi-tile">
              <div>Project start</div>
              <strong>{project.startDate ? new Date(project.startDate).toLocaleDateString() : "—"}</strong>
            </div>
            <div className="kpi-tile">
              <div>Nature of work</div>
              <strong>{project.natureOfWork || "—"}</strong>
            </div>
          </div>

          <form onSubmit={savePhase} className="form-row" style={{ marginTop: 12 }}>
            <div>
              <label>Start date </label>
              <input type="date" value={phaseForm.startDate} onChange={(e) => setPhaseForm({ ...phaseForm, startDate: e.target.value })} />
            </div>
            <input
              placeholder="Current phase (e.g. Execution)"
              value={phaseForm.currentPhase}
              onChange={(e) => setPhaseForm({ ...phaseForm, currentPhase: e.target.value })}
              style={{ width: 200 }}
            />
            <input
              placeholder="Nature of work (e.g. Raft Foundation & Finishing)"
              value={phaseForm.natureOfWork}
              onChange={(e) => setPhaseForm({ ...phaseForm, natureOfWork: e.target.value })}
              style={{ flex: 1 }}
            />
            <button type="submit" disabled={busy}>
              Save
            </button>
          </form>
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
