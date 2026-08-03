import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiClient } from "../api/client";

interface FleetRow {
  equipmentId: string;
  code: string;
  name: string;
  category: string | null;
  status: string;
  acquisitionDate: string;
  acquisitionCost: string;
  salvageValue: string;
  usefulLifeMonths: number;
  accumulatedDepreciation: string;
  netBookValue: string;
  currentContract: { code: string; name: string } | null;
  disposalProceeds: string | null;
  internalDayRate: string | null;
}

interface Account {
  id: string;
  code: string;
  name: string;
  controlAccountType: string | null;
  isPostable: boolean;
  isActive: boolean;
}

export function EquipmentPage() {
  const [fleet, setFleet] = useState<FleetRow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [disposing, setDisposing] = useState<string | null>(null);
  const [disposeForm, setDisposeForm] = useState({ proceeds: "", proceedsAccountId: "" });
  const [form, setForm] = useState({
    code: "",
    name: "",
    category: "",
    acquisitionDate: new Date().toISOString().slice(0, 10),
    acquisitionCost: "",
    salvageValue: "",
    usefulLifeMonths: "60",
    capitalizationCreditAccountId: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [fleetRes, accountsRes] = await Promise.all([
        apiClient.get<FleetRow[]>("/equipment/reports/fleet-register"),
        apiClient.get<Account[]>("/coa/accounts"),
      ]);
      setFleet(fleetRes.data);
      setAccounts(
        accountsRes.data.filter(
          (a) => a.isActive && a.isPostable && (a.controlAccountType === "BANK" || a.controlAccountType === "CASH"),
        ),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.post("/equipment/units", {
        code: form.code,
        name: form.name,
        category: form.category || undefined,
        acquisitionDate: form.acquisitionDate,
        acquisitionCost: form.acquisitionCost,
        salvageValue: form.salvageValue || "0",
        usefulLifeMonths: Number(form.usefulLifeMonths),
        capitalizationCreditAccountId: form.capitalizationCreditAccountId || undefined,
      });
      setForm({ ...form, code: "", name: "", category: "", acquisitionCost: "", salvageValue: "" });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create equipment");
    } finally {
      setSubmitting(false);
    }
  }

  const [dayRateEditing, setDayRateEditing] = useState<string | null>(null);
  const [dayRateValue, setDayRateValue] = useState("");

  async function saveDayRate(equipmentId: string) {
    setError(null);
    try {
      await apiClient.patch(`/equipment/units/${equipmentId}`, { internalDayRate: dayRateValue || "0" });
      setDayRateEditing(null);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to save day rate");
    }
  }

  async function handleDispose(equipmentId: string) {
    setError(null);
    try {
      await apiClient.post(`/equipment/units/${equipmentId}/dispose`, {
        proceeds: disposeForm.proceeds || "0",
        proceedsAccountId: disposeForm.proceedsAccountId,
      });
      setDisposing(null);
      setDisposeForm({ proceeds: "", proceedsAccountId: "" });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Disposal failed");
    }
  }

  return (
    <div>
      <div className="card">
        <h2>Equipment Fleet</h2>
        {error && <div className="error-banner">{error}</div>}
        {loading ? (
          <p>Loading…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Category</th>
                <th>Cost</th>
                <th>Accum. depr.</th>
                <th>NBV</th>
                <th>Life (mo)</th>
                <th>On contract</th>
                <th>Internal day rate</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {fleet.map((u) => (
                <tr key={u.equipmentId}>
                  <td>{u.code}</td>
                  <td>{u.name}</td>
                  <td>{u.category ?? "—"}</td>
                  <td>{Number(u.acquisitionCost).toFixed(2)}</td>
                  <td>{Number(u.accumulatedDepreciation).toFixed(2)}</td>
                  <td>{Number(u.netBookValue).toFixed(2)}</td>
                  <td>{u.usefulLifeMonths}</td>
                  <td>{u.currentContract ? u.currentContract.code : "—"}</td>
                  <td>
                    {dayRateEditing === u.equipmentId ? (
                      <span style={{ display: "inline-flex", gap: 4 }}>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          style={{ width: 90 }}
                          value={dayRateValue}
                          onChange={(e) => setDayRateValue(e.target.value)}
                          autoFocus
                        />
                        <button onClick={() => saveDayRate(u.equipmentId)}>Save</button>
                        <button className="secondary" onClick={() => setDayRateEditing(null)}>
                          ×
                        </button>
                      </span>
                    ) : (
                      <button
                        className="secondary"
                        style={{ padding: "2px 8px" }}
                        onClick={() => {
                          setDayRateEditing(u.equipmentId);
                          setDayRateValue(u.internalDayRate ?? "");
                        }}
                      >
                        {u.internalDayRate ? Number(u.internalDayRate).toFixed(2) : "Set…"}
                      </button>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${u.status === "ACTIVE" ? "posted" : "reversed"}`}>{u.status}</span>
                  </td>
                  <td>
                    {u.status === "ACTIVE" &&
                      (disposing === u.equipmentId ? (
                        <span style={{ display: "inline-flex", gap: 4 }}>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="Proceeds"
                            style={{ width: 90 }}
                            value={disposeForm.proceeds}
                            onChange={(e) => setDisposeForm({ ...disposeForm, proceeds: e.target.value })}
                          />
                          <select
                            value={disposeForm.proceedsAccountId}
                            onChange={(e) => setDisposeForm({ ...disposeForm, proceedsAccountId: e.target.value })}
                          >
                            <option value="" disabled>
                              To account…
                            </option>
                            {accounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.code}
                              </option>
                            ))}
                          </select>
                          <button onClick={() => handleDispose(u.equipmentId)} disabled={!disposeForm.proceedsAccountId}>
                            Confirm
                          </button>
                          <button className="secondary" onClick={() => setDisposing(null)}>
                            ×
                          </button>
                        </span>
                      ) : (
                        <button className="secondary" onClick={() => setDisposing(u.equipmentId)}>
                          Dispose
                        </button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>New equipment</h3>
        <form onSubmit={handleCreate}>
          <div className="form-row">
            <input placeholder="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
            <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required style={{ flex: 1 }} />
            <input placeholder="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={{ width: 110 }} />
            <div>
              <label>Acquired </label>
              <input type="date" value={form.acquisitionDate} onChange={(e) => setForm({ ...form, acquisitionDate: e.target.value })} required />
            </div>
          </div>
          <div className="form-row">
            <input type="number" min="0" step="0.01" placeholder="Acquisition cost" value={form.acquisitionCost} onChange={(e) => setForm({ ...form, acquisitionCost: e.target.value })} required />
            <input type="number" min="0" step="0.01" placeholder="Salvage value" value={form.salvageValue} onChange={(e) => setForm({ ...form, salvageValue: e.target.value })} />
            <div>
              <label>Useful life (months) </label>
              <input type="number" min="1" step="1" style={{ width: 70 }} value={form.usefulLifeMonths} onChange={(e) => setForm({ ...form, usefulLifeMonths: e.target.value })} required />
            </div>
            <select value={form.capitalizationCreditAccountId} onChange={(e) => setForm({ ...form, capitalizationCreditAccountId: e.target.value })}>
              <option value="">No capitalization JE (already on books)</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  Capitalize — pay from {a.code} {a.name}
                </option>
              ))}
            </select>
            <button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
