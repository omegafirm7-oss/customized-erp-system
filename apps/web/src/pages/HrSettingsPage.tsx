import { FormEvent, useEffect, useState } from "react";
import { apiClient } from "../api/client";

interface HrSettings {
  saudiEmployeeRatePct: string;
  saudiEmployerRatePct: string;
  expatEmployerRatePct: string;
  gosiWageFloor: string;
  gosiWageCap: string;
  overtimeMultiplier: string;
  hoursPerDay: string;
  daysPerMonth: string;
  defaultAnnualLeaveDays: string;
  eosbBasis: string;
  settlementExcludesEosbAndLeave: boolean;
  molEstablishmentId: string | null;
  employerBankCode: string | null;
  employerIban: string | null;
}

interface RecomputeResult {
  recomputed: { employeeCode: string; employeeName: string; oldNetAmount: string; newNetAmount: string }[];
  skipped: { employeeCode: string; employeeName: string; reason: string }[];
}

export function HrSettingsPage() {
  const [form, setForm] = useState<HrSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeResult, setRecomputeResult] = useState<RecomputeResult | null>(null);
  const [recomputeError, setRecomputeError] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get<HrSettings>("/hr/settings").then((res) => setForm(res.data));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const res = await apiClient.patch<HrSettings>("/hr/settings", {
        saudiEmployeeRatePct: form.saudiEmployeeRatePct,
        saudiEmployerRatePct: form.saudiEmployerRatePct,
        expatEmployerRatePct: form.expatEmployerRatePct,
        gosiWageFloor: form.gosiWageFloor,
        gosiWageCap: form.gosiWageCap,
        overtimeMultiplier: form.overtimeMultiplier,
        hoursPerDay: form.hoursPerDay,
        daysPerMonth: form.daysPerMonth,
        defaultAnnualLeaveDays: form.defaultAnnualLeaveDays,
        eosbBasis: form.eosbBasis,
        settlementExcludesEosbAndLeave: form.settlementExcludesEosbAndLeave,
        molEstablishmentId: form.molEstablishmentId || undefined,
        employerBankCode: form.employerBankCode || undefined,
        employerIban: form.employerIban || undefined,
      });
      setForm(res.data);
      setSaved(true);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function recompute() {
    if (!window.confirm("Reverse and repost every already-released employee's final settlement under the current settings? Settlements with payments already recorded will be skipped.")) {
      return;
    }
    setRecomputeError(null);
    setRecomputeResult(null);
    setRecomputing(true);
    try {
      const res = await apiClient.post<RecomputeResult>("/hr/settlements/recompute");
      setRecomputeResult(res.data);
    } catch (err: any) {
      setRecomputeError(err?.response?.data?.message ?? "Failed to recompute settlements");
    } finally {
      setRecomputing(false);
    }
  }

  if (!form) return <p>Loading…</p>;

  const set = (key: keyof HrSettings) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [key]: e.target.value });

  return (
    <div className="card">
      <h2>HR Settings</h2>
      <p style={{ color: "#667085", fontSize: 13 }}>
        Statutory GOSI rates and payroll conventions. Rates are configurable because GOSI reform adjusts
        contribution percentages over time — update here, never in code.
      </p>
      {error && <div className="error-banner">{error}</div>}
      {saved && <p style={{ color: "#027a48" }}>Saved.</p>}
      <form onSubmit={save}>
        <h3>GOSI</h3>
        <div className="form-row">
          <div>
            <label>Saudi employee % </label>
            <input type="number" min="0" step="0.01" value={form.saudiEmployeeRatePct} onChange={set("saudiEmployeeRatePct")} />
          </div>
          <div>
            <label>Saudi employer % </label>
            <input type="number" min="0" step="0.01" value={form.saudiEmployerRatePct} onChange={set("saudiEmployerRatePct")} />
          </div>
          <div>
            <label>Expat employer % </label>
            <input type="number" min="0" step="0.01" value={form.expatEmployerRatePct} onChange={set("expatEmployerRatePct")} />
          </div>
          <div>
            <label>Wage floor </label>
            <input type="number" min="0" step="0.01" value={form.gosiWageFloor} onChange={set("gosiWageFloor")} />
          </div>
          <div>
            <label>Wage cap </label>
            <input type="number" min="0" step="0.01" value={form.gosiWageCap} onChange={set("gosiWageCap")} />
          </div>
        </div>
        <h3>Payroll conventions</h3>
        <div className="form-row">
          <div>
            <label>Overtime × </label>
            <input type="number" min="0" step="0.1" value={form.overtimeMultiplier} onChange={set("overtimeMultiplier")} />
          </div>
          <div>
            <label>Hours/day </label>
            <input type="number" min="1" step="1" value={form.hoursPerDay} onChange={set("hoursPerDay")} />
          </div>
          <div>
            <label>Days/month </label>
            <input type="number" min="1" step="1" value={form.daysPerMonth} onChange={set("daysPerMonth")} />
          </div>
          <div>
            <label>Annual leave days </label>
            <input type="number" min="0" step="1" value={form.defaultAnnualLeaveDays} onChange={set("defaultAnnualLeaveDays")} />
          </div>
          <div>
            <label>EOSB wage basis </label>
            <select value={form.eosbBasis} onChange={set("eosbBasis")}>
              <option value="FULL_GROSS">Full gross (statutory default)</option>
              <option value="BASIC_HOUSING">Basic + housing</option>
              <option value="BASIC_ONLY">Basic only</option>
            </select>
          </div>
        </div>
        <h3>Final settlement policy</h3>
        <div className="form-row">
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={form.settlementExcludesEosbAndLeave}
              onChange={(e) => setForm({ ...form, settlementExcludesEosbAndLeave: e.target.checked })}
            />
            Settlements exclude EOSB &amp; leave payout — net amount is only unpaid timesheet wages
          </label>
        </div>
        <h3>WPS (Wage Protection System)</h3>
        <div className="form-row">
          <input placeholder="MOL establishment ID" value={form.molEstablishmentId ?? ""} onChange={set("molEstablishmentId")} />
          <input placeholder="Employer bank code" value={form.employerBankCode ?? ""} onChange={set("employerBankCode")} style={{ width: 130 }} />
          <input placeholder="Employer IBAN" value={form.employerIban ?? ""} onChange={set("employerIban")} style={{ flex: 1 }} />
        </div>
        <button type="submit" disabled={saving} style={{ marginTop: 10 }}>
          {saving ? "Saving…" : "Save settings"}
        </button>
      </form>

      <hr style={{ margin: "20px 0" }} />
      <h3>Recompute existing settlements</h3>
      <p style={{ color: "#667085", fontSize: 13 }}>
        Applies the settings above (save first) to every already-released employee's final settlement — reverses
        and reposts each one that has no payments recorded yet. Use this after changing the settlement policy so
        past releases match the new rule, not just future ones.
      </p>
      {recomputeError && <div className="error-banner">{recomputeError}</div>}
      <button onClick={recompute} disabled={recomputing}>
        {recomputing ? "Recomputing…" : "Recompute all settlements"}
      </button>
      {recomputeResult && (
        <div style={{ marginTop: 12 }}>
          <p>
            <strong>{recomputeResult.recomputed.length}</strong> recomputed,{" "}
            <strong>{recomputeResult.skipped.length}</strong> skipped.
          </p>
          {recomputeResult.recomputed.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Old net amount</th>
                  <th>New net amount</th>
                </tr>
              </thead>
              <tbody>
                {recomputeResult.recomputed.map((r) => (
                  <tr key={r.employeeCode}>
                    <td>
                      {r.employeeCode} — {r.employeeName}
                    </td>
                    <td>{r.oldNetAmount}</td>
                    <td>{r.newNetAmount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {recomputeResult.skipped.length > 0 && (
            <>
              <p style={{ marginTop: 10, color: "#b54708" }}>Skipped:</p>
              <table>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {recomputeResult.skipped.map((s) => (
                    <tr key={s.employeeCode}>
                      <td>
                        {s.employeeCode} — {s.employeeName}
                      </td>
                      <td>{s.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}
