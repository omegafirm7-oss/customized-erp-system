import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiClient } from "../../api/client";

interface Partner {
  id: string;
  code: string;
  name: string;
}

interface Opportunity {
  id: string;
  name: string;
  stage: string;
  estimatedValue: string;
  probability: number;
  expectedCloseDate: string | null;
  lostReason: string | null;
  businessPartner: { code: string; name: string } | null;
  leadSource: { name: string } | null;
}

interface Activity {
  id: string;
  type: string;
  subject: string;
  notes: string | null;
  dueDate: string | null;
  completedAt: string | null;
}

const STAGES = ["NEW", "QUALIFICATION", "PROPOSAL", "NEGOTIATION", "WON", "LOST"];
const OPEN_STAGES = ["NEW", "QUALIFICATION", "PROPOSAL", "NEGOTIATION"];

function money(v: string | number): string {
  return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function emptyForm() {
  return { name: "", businessPartnerId: "", estimatedValue: "0", probability: "0", expectedCloseDate: "" };
}

function emptyActivity() {
  return { type: "CALL", subject: "", notes: "", dueDate: "" };
}

export function OpportunitiesPage() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [submitting, setSubmitting] = useState(false);
  const [losingId, setLosingId] = useState<string | null>(null);
  const [lostReason, setLostReason] = useState("");

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activityForm, setActivityForm] = useState(emptyActivity());

  const load = useCallback(() => {
    setLoading(true);
    return apiClient
      .get<Opportunity[]>("/crm/opportunities", { params: stageFilter ? { stage: stageFilter } : {} })
      .then((res) => setOpportunities(res.data))
      .catch((err) => setError(err?.response?.data?.message ?? "Failed to load opportunities"))
      .finally(() => setLoading(false));
  }, [stageFilter]);

  useEffect(() => {
    load();
    apiClient.get<Partner[]>("/partners").then((res) => setPartners(res.data));
  }, [load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.post("/crm/opportunities", {
        name: form.name,
        businessPartnerId: form.businessPartnerId || undefined,
        estimatedValue: form.estimatedValue,
        probability: Number(form.probability),
        expectedCloseDate: form.expectedCloseDate ? new Date(form.expectedCloseDate).toISOString() : undefined,
      });
      setForm(emptyForm());
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create opportunity");
    } finally {
      setSubmitting(false);
    }
  }

  async function updateStage(id: string, stage: string) {
    setBusyId(id);
    setError(null);
    try {
      await apiClient.patch(`/crm/opportunities/${id}`, { stage });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to update opportunity");
    } finally {
      setBusyId(null);
    }
  }

  async function win(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await apiClient.post(`/crm/opportunities/${id}/win`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to mark won");
    } finally {
      setBusyId(null);
    }
  }

  async function submitLose(e: FormEvent, id: string) {
    e.preventDefault();
    setBusyId(id);
    setError(null);
    try {
      await apiClient.post(`/crm/opportunities/${id}/lose`, { lostReason: lostReason || undefined });
      setLosingId(null);
      setLostReason("");
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to mark lost");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActivities(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    try {
      const res = await apiClient.get<Activity[]>("/crm/activities", { params: { opportunityId: id } });
      setActivities(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to load activities");
    }
  }

  async function addActivity(e: FormEvent, opportunityId: string) {
    e.preventDefault();
    setError(null);
    try {
      await apiClient.post("/crm/activities", {
        type: activityForm.type,
        subject: activityForm.subject,
        notes: activityForm.notes || undefined,
        dueDate: activityForm.dueDate ? new Date(activityForm.dueDate).toISOString() : undefined,
        opportunityId,
      });
      setActivityForm(emptyActivity());
      const res = await apiClient.get<Activity[]>("/crm/activities", { params: { opportunityId } });
      setActivities(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to add activity");
    }
  }

  return (
    <div>
      <div className="card">
        <h2>Opportunities</h2>
        {error && <div className="error-banner">{error}</div>}
        <div className="form-row" style={{ marginBottom: 10 }}>
          <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
            <option value="">All stages</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        {loading ? (
          <p>Loading…</p>
        ) : opportunities.length === 0 ? (
          <p>No opportunities yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Partner</th>
                <th>Value</th>
                <th>Probability</th>
                <th>Expected close</th>
                <th>Stage</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {opportunities.map((o) => (
                <>
                  <tr key={o.id}>
                    <td>{o.name}</td>
                    <td>{o.businessPartner ? `${o.businessPartner.code} — ${o.businessPartner.name}` : "—"}</td>
                    <td>{money(o.estimatedValue)}</td>
                    <td>{o.probability}%</td>
                    <td>{o.expectedCloseDate ? new Date(o.expectedCloseDate).toLocaleDateString() : "—"}</td>
                    <td>
                      <span className={`badge ${o.stage === "WON" ? "posted" : o.stage === "LOST" ? "reversed" : "draft"}`}>
                        {o.stage}
                        {o.stage === "LOST" && o.lostReason ? `: ${o.lostReason}` : ""}
                      </span>
                    </td>
                    <td>
                      <button className="secondary" onClick={() => toggleActivities(o.id)}>
                        Activities
                      </button>{" "}
                      {OPEN_STAGES.includes(o.stage) && (
                        <>
                          <select value={o.stage} disabled={busyId === o.id} onChange={(e) => updateStage(o.id, e.target.value)}>
                            {OPEN_STAGES.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>{" "}
                          <button className="secondary" disabled={busyId === o.id} onClick={() => win(o.id)}>
                            Win
                          </button>{" "}
                          <button
                            className="secondary"
                            disabled={busyId === o.id}
                            onClick={() => setLosingId(losingId === o.id ? null : o.id)}
                          >
                            Lose
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                  {losingId === o.id && (
                    <tr>
                      <td colSpan={7}>
                        <form onSubmit={(e) => submitLose(e, o.id)} className="form-row">
                          <input
                            placeholder="Lost reason (optional)"
                            value={lostReason}
                            onChange={(e) => setLostReason(e.target.value)}
                            style={{ flex: 1 }}
                          />
                          <button type="submit" disabled={busyId === o.id}>
                            Confirm lost
                          </button>
                        </form>
                      </td>
                    </tr>
                  )}
                  {expandedId === o.id && (
                    <tr>
                      <td colSpan={7}>
                        <div className="card" style={{ margin: 0 }}>
                          <h4>Activities</h4>
                          {activities.length === 0 ? (
                            <p style={{ color: "#98a2b3" }}>No activities logged yet.</p>
                          ) : (
                            <ul>
                              {activities.map((a) => (
                                <li key={a.id}>
                                  <strong>{a.type}</strong> — {a.subject}
                                  {a.dueDate && ` (due ${new Date(a.dueDate).toLocaleDateString()})`}
                                  {a.completedAt && " ✓ done"}
                                  {a.notes && <div style={{ color: "#667085" }}>{a.notes}</div>}
                                </li>
                              ))}
                            </ul>
                          )}
                          <form onSubmit={(e) => addActivity(e, o.id)} className="form-row">
                            <select value={activityForm.type} onChange={(e) => setActivityForm({ ...activityForm, type: e.target.value })}>
                              <option value="CALL">Call</option>
                              <option value="MEETING">Meeting</option>
                              <option value="EMAIL">Email</option>
                              <option value="NOTE">Note</option>
                              <option value="TASK">Task</option>
                            </select>
                            <input
                              placeholder="Subject"
                              value={activityForm.subject}
                              onChange={(e) => setActivityForm({ ...activityForm, subject: e.target.value })}
                              required
                              style={{ flex: 1 }}
                            />
                            <input
                              type="date"
                              value={activityForm.dueDate}
                              onChange={(e) => setActivityForm({ ...activityForm, dueDate: e.target.value })}
                            />
                            <button type="submit">Add</button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>New opportunity</h3>
        <form onSubmit={handleCreate}>
          <div className="form-row">
            <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required style={{ flex: 1 }} />
            <select value={form.businessPartnerId} onChange={(e) => setForm({ ...form, businessPartnerId: e.target.value })}>
              <option value="">No partner</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Estimated value"
              value={form.estimatedValue}
              onChange={(e) => setForm({ ...form, estimatedValue: e.target.value })}
            />
            <input
              type="number"
              min="0"
              max="100"
              placeholder="Probability %"
              value={form.probability}
              onChange={(e) => setForm({ ...form, probability: e.target.value })}
            />
            <div>
              <label>Expected close </label>
              <input type="date" value={form.expectedCloseDate} onChange={(e) => setForm({ ...form, expectedCloseDate: e.target.value })} />
            </div>
          </div>
          <button type="submit" disabled={submitting || !form.name} style={{ marginTop: 12 }}>
            {submitting ? "Saving…" : "Create opportunity"}
          </button>
        </form>
      </div>
    </div>
  );
}
