import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiClient } from "../../api/client";

interface Lead {
  id: string;
  name: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  source: string;
  status: string;
  notes: string | null;
  createdAt: string;
}

interface Activity {
  id: string;
  type: string;
  subject: string;
  notes: string | null;
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
}

const SOURCES = ["WEBSITE", "REFERRAL", "COLD_CALL", "EVENT", "OTHER"];
const STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "DISQUALIFIED", "CONVERTED"];

function emptyForm() {
  return { name: "", companyName: "", email: "", phone: "", source: "OTHER", notes: "" };
}

function emptyActivity() {
  return { type: "CALL", subject: "", notes: "", dueDate: "" };
}

export function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [submitting, setSubmitting] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activityForm, setActivityForm] = useState(emptyActivity());
  const [opportunityForm, setOpportunityForm] = useState({ name: "", estimatedValue: "0" });
  const [convertingId, setConvertingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    return apiClient
      .get<Lead[]>("/crm/leads", { params: statusFilter ? { status: statusFilter } : {} })
      .then((res) => setLeads(res.data))
      .catch((err) => setError(err?.response?.data?.message ?? "Failed to load leads"))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.post("/crm/leads", {
        name: form.name,
        companyName: form.companyName || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
        source: form.source,
        notes: form.notes || undefined,
      });
      setForm(emptyForm());
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create lead");
    } finally {
      setSubmitting(false);
    }
  }

  async function updateStatus(id: string, status: string) {
    setBusyId(id);
    setError(null);
    try {
      await apiClient.patch(`/crm/leads/${id}`, { status });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to update lead");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActivities(leadId: string) {
    if (expandedId === leadId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(leadId);
    setConvertingId(null);
    try {
      const res = await apiClient.get<Activity[]>("/crm/activities", { params: { leadId } });
      setActivities(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to load activities");
    }
  }

  async function addActivity(e: FormEvent, leadId: string) {
    e.preventDefault();
    setError(null);
    try {
      await apiClient.post("/crm/activities", {
        type: activityForm.type,
        subject: activityForm.subject,
        notes: activityForm.notes || undefined,
        dueDate: activityForm.dueDate ? new Date(activityForm.dueDate).toISOString() : undefined,
        leadId,
      });
      setActivityForm(emptyActivity());
      const res = await apiClient.get<Activity[]>("/crm/activities", { params: { leadId } });
      setActivities(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to add activity");
    }
  }

  async function convertLead(e: FormEvent, leadId: string) {
    e.preventDefault();
    setBusyId(leadId);
    setError(null);
    try {
      await apiClient.post(`/crm/opportunities/from-lead/${leadId}`, {
        name: opportunityForm.name,
        estimatedValue: opportunityForm.estimatedValue,
      });
      setConvertingId(null);
      setOpportunityForm({ name: "", estimatedValue: "0" });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to convert lead");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>Leads</h2>
        {error && <div className="error-banner">{error}</div>}
        <div className="form-row" style={{ marginBottom: 10 }}>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        {loading ? (
          <p>Loading…</p>
        ) : leads.length === 0 ? (
          <p>No leads yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Company</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Source</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <>
                  <tr key={l.id}>
                    <td>{l.name}</td>
                    <td>{l.companyName ?? "—"}</td>
                    <td>{l.email ?? "—"}</td>
                    <td>{l.phone ?? "—"}</td>
                    <td>{l.source}</td>
                    <td>
                      <span className={`badge ${l.status === "CONVERTED" ? "posted" : l.status === "DISQUALIFIED" ? "reversed" : "draft"}`}>
                        {l.status}
                      </span>
                    </td>
                    <td>
                      <button className="secondary" onClick={() => toggleActivities(l.id)}>
                        Activities
                      </button>{" "}
                      {l.status !== "CONVERTED" && l.status !== "DISQUALIFIED" && (
                        <>
                          {l.status === "QUALIFIED" && (
                            <button
                              className="secondary"
                              disabled={busyId === l.id}
                              onClick={() => {
                                setConvertingId(convertingId === l.id ? null : l.id);
                                setExpandedId(null);
                                setOpportunityForm({ name: l.name, estimatedValue: "0" });
                              }}
                            >
                              Convert
                            </button>
                          )}{" "}
                          <select
                            value={l.status}
                            disabled={busyId === l.id}
                            onChange={(e) => updateStatus(l.id, e.target.value)}
                          >
                            {STATUSES.filter((s) => s !== "CONVERTED").map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </>
                      )}
                    </td>
                  </tr>
                  {convertingId === l.id && (
                    <tr>
                      <td colSpan={7}>
                        <form onSubmit={(e) => convertLead(e, l.id)} className="form-row">
                          <input
                            placeholder="Opportunity name"
                            value={opportunityForm.name}
                            onChange={(e) => setOpportunityForm({ ...opportunityForm, name: e.target.value })}
                            required
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="Estimated value"
                            value={opportunityForm.estimatedValue}
                            onChange={(e) => setOpportunityForm({ ...opportunityForm, estimatedValue: e.target.value })}
                          />
                          <button type="submit" disabled={busyId === l.id}>
                            Create opportunity
                          </button>
                        </form>
                      </td>
                    </tr>
                  )}
                  {expandedId === l.id && (
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
                          <form onSubmit={(e) => addActivity(e, l.id)} className="form-row">
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
        <h3>New lead</h3>
        <form onSubmit={handleCreate}>
          <div className="form-row">
            <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required style={{ flex: 1 }} />
            <input placeholder="Company (optional)" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} style={{ flex: 1 }} />
          </div>
          <div className="form-row">
            <input placeholder="Email (optional)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={{ flex: 1 }} />
            <input placeholder="Phone (optional)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={{ flex: 1 }} />
            <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <input placeholder="Notes (optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={{ flex: 1 }} />
          </div>
          <button type="submit" disabled={submitting || !form.name} style={{ marginTop: 12 }}>
            {submitting ? "Saving…" : "Create lead"}
          </button>
        </form>
      </div>
    </div>
  );
}
