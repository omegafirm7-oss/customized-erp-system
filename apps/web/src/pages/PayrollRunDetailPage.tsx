import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiClient } from "../api/client";

interface RunLine {
  id: string;
  employee: { code: string; nameEn: string; isSaudi: boolean };
  costCenter: { code: string } | null;
  basicSalary: string;
  housingAllowance: string;
  transportAllowance: string;
  otherAllowance: string;
  unpaidDays: string;
  absentDays: string;
  overtimeHours: string;
  annualLeaveDaysTaken: string;
  otherDeduction: string;
  overtimePay: string;
  absenceDeduction: string;
  loanDeduction: string;
  gosiEmployee: string;
  gosiEmployer: string;
  grossPay: string;
  netPay: string;
  eosbDelta: string;
  leaveDelta: string;
}

interface RunDetail {
  id: string;
  runNumber: string | null;
  status: string;
  fiscalPeriod: { periodNumber: number; startDate: string; endDate: string };
  totalGross: string;
  totalGosiEmployee: string;
  totalGosiEmployer: string;
  totalLoanDeductions: string;
  totalNetPay: string;
  totalEosbDelta: string;
  totalLeaveDelta: string;
  lines: RunLine[];
}

export function PayrollRunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingLine, setEditingLine] = useState<string | null>(null);
  const [edit, setEdit] = useState({ unpaidDays: "0", absentDays: "0", overtimeHours: "0", annualLeaveDaysTaken: "0", otherDeduction: "0" });

  const load = useCallback(async () => {
    const res = await apiClient.get<RunDetail>(`/hr/payroll-runs/${id}`);
    setRun(res.data);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  function startEdit(line: RunLine) {
    setEditingLine(line.id);
    setEdit({
      unpaidDays: line.unpaidDays,
      absentDays: line.absentDays,
      overtimeHours: line.overtimeHours,
      annualLeaveDaysTaken: line.annualLeaveDaysTaken,
      otherDeduction: line.otherDeduction,
    });
  }

  async function saveEdit(lineId: string) {
    setError(null);
    setBusy(true);
    try {
      await apiClient.patch(`/hr/payroll-runs/${id}/lines/${lineId}`, edit);
      setEditingLine(null);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to update line");
    } finally {
      setBusy(false);
    }
  }

  async function action(path: string, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setError(null);
    setBusy(true);
    try {
      await apiClient.post(`/hr/payroll-runs/${id}/${path}`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? `${path} failed`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteDraft() {
    if (!window.confirm("Delete this draft run?")) return;
    await apiClient.delete(`/hr/payroll-runs/${id}`);
    navigate("/hr/payroll-runs");
  }

  async function download(path: string, fallbackName: string) {
    setError(null);
    try {
      const res = await apiClient.get(`/hr/payroll-runs/${id}/${path}`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fallbackName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      const blob = err?.response?.data;
      if (blob instanceof Blob) {
        const text = await blob.text();
        try {
          setError(JSON.parse(text).message ?? "Download failed");
        } catch {
          setError("Download failed");
        }
      } else {
        setError("Download failed");
      }
    }
  }

  if (!run) return <p>Loading…</p>;

  const isDraft = run.status === "DRAFT";

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>
            Payroll {run.runNumber ?? "(draft)"} — Period {run.fiscalPeriod.periodNumber}{" "}
            <span className={`badge ${run.status === "POSTED" ? "posted" : run.status === "REVERSED" ? "reversed" : "draft"}`}>
              {run.status}
            </span>
          </h2>
          <span>
            {isDraft && (
              <>
                <button className="secondary" onClick={() => action("recompute")} disabled={busy}>
                  Recompute
                </button>{" "}
                <button onClick={() => action("post", "Post this payroll run to the GL?")} disabled={busy}>
                  Post run
                </button>{" "}
                <button className="secondary" onClick={deleteDraft} disabled={busy}>
                  Delete draft
                </button>
              </>
            )}
            {run.status === "POSTED" && (
              <>
                <button className="secondary" onClick={() => download("wps-file", "wps.csv")}>
                  WPS file
                </button>{" "}
                <button className="secondary" onClick={() => download("register.csv", "payroll_register.csv")}>
                  Register CSV
                </button>{" "}
                <button className="secondary" onClick={() => action("reverse", "Reverse this posted payroll run?")} disabled={busy}>
                  Reverse
                </button>
              </>
            )}
          </span>
        </div>
        {error && <div className="error-banner">{error}</div>}
        <p style={{ color: "#667085", fontSize: 13 }}>
          Gross {Number(run.totalGross).toFixed(2)} · GOSI employee {Number(run.totalGosiEmployee).toFixed(2)} /
          employer {Number(run.totalGosiEmployer).toFixed(2)} · Loans {Number(run.totalLoanDeductions).toFixed(2)} ·
          EOSB Δ {Number(run.totalEosbDelta).toFixed(2)} · Leave Δ {Number(run.totalLeaveDelta).toFixed(2)} ·{" "}
          <strong>Net pay {Number(run.totalNetPay).toFixed(2)}</strong>
        </p>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>CC</th>
                <th>Basic</th>
                <th>Allowances</th>
                <th>Unpaid</th>
                <th>Absent</th>
                <th>OT hrs</th>
                <th>Leave taken</th>
                <th>Other ded.</th>
                <th>OT pay</th>
                <th>Absence ded.</th>
                <th>GOSI (emp)</th>
                <th>Loan</th>
                <th>Gross</th>
                <th>Net</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {run.lines.map((line) => {
                const allowances =
                  Number(line.housingAllowance) + Number(line.transportAllowance) + Number(line.otherAllowance);
                const editing = editingLine === line.id;
                return (
                  <tr key={line.id}>
                    <td>
                      {line.employee.code} — {line.employee.nameEn}
                    </td>
                    <td>{line.costCenter?.code ?? "—"}</td>
                    <td>{Number(line.basicSalary).toFixed(2)}</td>
                    <td>{allowances.toFixed(2)}</td>
                    {editing ? (
                      <>
                        <td>
                          <input type="number" min="0" step="0.5" style={{ width: 55 }} value={edit.unpaidDays} onChange={(e) => setEdit({ ...edit, unpaidDays: e.target.value })} />
                        </td>
                        <td>
                          <input type="number" min="0" step="0.5" style={{ width: 55 }} value={edit.absentDays} onChange={(e) => setEdit({ ...edit, absentDays: e.target.value })} />
                        </td>
                        <td>
                          <input type="number" min="0" step="0.5" style={{ width: 55 }} value={edit.overtimeHours} onChange={(e) => setEdit({ ...edit, overtimeHours: e.target.value })} />
                        </td>
                        <td>
                          <input type="number" min="0" step="0.5" style={{ width: 55 }} value={edit.annualLeaveDaysTaken} onChange={(e) => setEdit({ ...edit, annualLeaveDaysTaken: e.target.value })} />
                        </td>
                        <td>
                          <input type="number" min="0" step="0.01" style={{ width: 70 }} value={edit.otherDeduction} onChange={(e) => setEdit({ ...edit, otherDeduction: e.target.value })} />
                        </td>
                      </>
                    ) : (
                      <>
                        <td>{Number(line.unpaidDays)}</td>
                        <td>{Number(line.absentDays)}</td>
                        <td>{Number(line.overtimeHours)}</td>
                        <td>{Number(line.annualLeaveDaysTaken)}</td>
                        <td>{Number(line.otherDeduction).toFixed(2)}</td>
                      </>
                    )}
                    <td>{Number(line.overtimePay).toFixed(2)}</td>
                    <td>{Number(line.absenceDeduction).toFixed(2)}</td>
                    <td>{Number(line.gosiEmployee).toFixed(2)}</td>
                    <td>{Number(line.loanDeduction).toFixed(2)}</td>
                    <td>{Number(line.grossPay).toFixed(2)}</td>
                    <td>
                      <strong>{Number(line.netPay).toFixed(2)}</strong>
                    </td>
                    <td>
                      {isDraft &&
                        (editing ? (
                          <>
                            <button onClick={() => saveEdit(line.id)} disabled={busy}>
                              Save
                            </button>{" "}
                            <button className="secondary" onClick={() => setEditingLine(null)}>
                              ×
                            </button>
                          </>
                        ) : (
                          <button className="secondary" onClick={() => startEdit(line)}>
                            Edit
                          </button>
                        ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
