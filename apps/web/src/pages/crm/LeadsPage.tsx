import { FormEvent, Fragment, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../../api/client";
import { OutreachComposer } from "./OutreachComposer";
import { AgentStatus, BUSINESS_LINES, CONTRACTOR_GRADES, PRIORITIES, SAFETY_CERTS } from "./salesAgentConstants";

interface Lead {
  id: string;
  name: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  source: string;
  status: string;
  notes: string | null;
  priority: string;
  businessLines: string[];
  safetyCertsRequired: string[];
  contractorGrade: string | null;
  companyWebsite: string | null;
  projectName: string | null;
  city: string | null;
  estimatedValue: string | null;
  followUpDate: string | null;
  aiRationale: string | null;
  aiConfidence: string | null;
  createdAt: string;
}

interface Activity {
  id: string;
  type: string;
  subject: string;
  notes: string | null;
  dueDate: string | null;
  completedAt: string | null;
  sentAt: string | null;
  messageSubject: string | null;
  messageBody: string | null;
  recipient: string | null;
  autoSend: boolean;
  sendError: string | null;
  createdAt: string;
}

const SOURCES = ["WEBSITE", "REFERRAL", "COLD_CALL", "EVENT", "AI_RESEARCH", "OTHER"];
const STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "DISQUALIFIED", "CONVERTED"];

function emptyForm() {
  return {
    name: "",
    companyName: "",
    email: "",
    phone: "",
    source: "OTHER",
    notes: "",
    priority: "WARM",
    businessLines: ["training"] as string[],
    safetyCertsRequired: [] as string[],
    contractorGrade: "",
    companyWebsite: "",
    projectName: "",
    city: "",
    estimatedValue: "",
    followUpDate: "",
  };
}
type LeadForm = ReturnType<typeof emptyForm>;

function formFromLead(l: Lead): LeadForm {
  return {
    name: l.name,
    companyName: l.companyName ?? "",
    email: l.email ?? "",
    phone: l.phone ?? "",
    source: l.source,
    notes: l.notes ?? "",
    priority: l.priority,
    businessLines: l.businessLines ?? [],
    safetyCertsRequired: l.safetyCertsRequired ?? [],
    contractorGrade: l.contractorGrade ?? "",
    companyWebsite: l.companyWebsite ?? "",
    projectName: l.projectName ?? "",
    city: l.city ?? "",
    estimatedValue: l.estimatedValue ? String(Number(l.estimatedValue)) : "",
    followUpDate: l.followUpDate ? l.followUpDate.slice(0, 10) : "",
  };
}

function payloadFromForm(f: LeadForm) {
  return {
    name: f.name,
    companyName: f.companyName || undefined,
    email: f.email || undefined,
    phone: f.phone || undefined,
    source: f.source,
    notes: f.notes || undefined,
    priority: f.priority,
    businessLines: f.businessLines,
    safetyCertsRequired: f.safetyCertsRequired,
    contractorGrade: f.contractorGrade || undefined,
    companyWebsite: f.companyWebsite || undefined,
    projectName: f.projectName || undefined,
    city: f.city || undefined,
    estimatedValue: f.estimatedValue || undefined,
    followUpDate: f.followUpDate ? new Date(f.followUpDate).toISOString() : undefined,
  };
}

function emptyActivity() {
  return { type: "CALL", subject: "", notes: "", dueDate: "" };
}

function toggle(list: string[], value: string) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

const today = () => new Date().toISOString().slice(0, 10);

export function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [messagingId, setMessagingId] = useState<string | null>(null);
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

  useEffect(() => {
    apiClient
      .get<AgentStatus>("/crm/agent/status")
      .then((res) => setAgentStatus(res.data))
      .catch(() => setAgentStatus(null));
  }, []);

  const visible = leads.filter((l) => {
    if (priorityFilter && l.priority !== priorityFilter) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return [l.name, l.companyName, l.email, l.phone, l.city, l.projectName].some((v) => (v ?? "").toLowerCase().includes(s));
  });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (editingId) {
        await apiClient.patch(`/crm/leads/${editingId}`, payloadFromForm(form));
      } else {
        await apiClient.post("/crm/leads", payloadFromForm(form));
      }
      setForm(emptyForm());
      setEditingId(null);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to save lead");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(l: Lead) {
    setEditingId(l.id);
    setForm(formFromLead(l));
    document.getElementById("lead-form")?.scrollIntoView({ behavior: "smooth" });
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

  async function loadActivities(leadId: string) {
    try {
      const res = await apiClient.get<Activity[]>("/crm/activities", { params: { leadId } });
      setActivities(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to load activities");
    }
  }

  async function toggleActivities(leadId: string) {
    if (expandedId === leadId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(leadId);
    setConvertingId(null);
    setMessagingId(null);
    await loadActivities(leadId);
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
      await loadActivities(leadId);
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ margin: 0 }}>Leads</h2>
          <div className="button-group">
            <Link to="/crm/lead-research">
              <button type="button" className="secondary">Find leads with AI</button>
            </Link>{" "}
            <Link to="/crm/outreach">
              <button type="button" className="secondary">Follow-ups</button>
            </Link>
          </div>
        </div>
        {error && <div className="error-banner">{error}</div>}
        <div className="form-row" style={{ margin: "12px 0 10px" }}>
          <input placeholder="Search company, contact, phone, city…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1 }} />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
            <option value="">All priorities</option>
            {PRIORITIES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        {loading ? (
          <p>Loading…</p>
        ) : visible.length === 0 ? (
          <p>No leads yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Company / contact</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Follow-up</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((l) => (
                <Fragment key={l.id}>
                  <tr>
                    <td>
                      <strong>{l.companyName ?? l.name}</strong>
                      {l.companyName && l.name !== l.companyName && <div className="lead-sub">{l.name}</div>}
                      <div className="lead-sub">
                        {[l.city, l.projectName, l.source === "AI_RESEARCH" ? "AI research" : null].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td>{l.phone ?? "—"}</td>
                    <td>{l.email ?? "—"}</td>
                    <td>
                      <span className={`priority-pill ${l.priority.toLowerCase()}`}>{l.priority}</span>
                    </td>
                    <td>
                      <span className={`badge ${l.status === "CONVERTED" ? "posted" : l.status === "DISQUALIFIED" ? "reversed" : "draft"}`}>
                        {l.status}
                      </span>
                    </td>
                    <td>
                      {l.followUpDate ? (
                        <span className={l.followUpDate.slice(0, 10) <= today() ? "followup-due" : undefined}>
                          {new Date(l.followUpDate).toLocaleDateString()}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {l.status !== "CONVERTED" && l.status !== "DISQUALIFIED" && (
                        <button
                          onClick={() => {
                            setMessagingId(messagingId === l.id ? null : l.id);
                            setExpandedId(null);
                            setConvertingId(null);
                          }}
                        >
                          Message
                        </button>
                      )}{" "}
                      <button className="secondary" onClick={() => toggleActivities(l.id)}>
                        History
                      </button>{" "}
                      {l.status !== "CONVERTED" && (
                        <button className="secondary" onClick={() => startEdit(l)}>
                          Edit
                        </button>
                      )}{" "}
                      {l.status !== "CONVERTED" && l.status !== "DISQUALIFIED" && (
                        <>
                          {l.status === "QUALIFIED" && (
                            <button
                              className="secondary"
                              disabled={busyId === l.id}
                              onClick={() => {
                                setConvertingId(convertingId === l.id ? null : l.id);
                                setExpandedId(null);
                                setMessagingId(null);
                                setOpportunityForm({ name: l.companyName ?? l.name, estimatedValue: l.estimatedValue ? String(Number(l.estimatedValue)) : "0" });
                              }}
                            >
                              Convert
                            </button>
                          )}{" "}
                          <select value={l.status} disabled={busyId === l.id} onChange={(e) => updateStatus(l.id, e.target.value)}>
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
                  {messagingId === l.id && (
                    <tr>
                      <td colSpan={7}>
                        <OutreachComposer
                          lead={l}
                          status={agentStatus}
                          onSent={() => {
                            load();
                          }}
                          onClose={() => setMessagingId(null)}
                        />
                      </td>
                    </tr>
                  )}
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
                          <LeadDetails lead={l} />
                          <h4>History</h4>
                          {activities.length === 0 ? (
                            <p style={{ color: "#98a2b3" }}>No activities logged yet.</p>
                          ) : (
                            <ul className="activity-list">
                              {activities.map((a) => (
                                <ActivityItem key={a.id} a={a} />
                              ))}
                            </ul>
                          )}
                          <form onSubmit={(e) => addActivity(e, l.id)} className="form-row">
                            <select value={activityForm.type} onChange={(e) => setActivityForm({ ...activityForm, type: e.target.value })}>
                              <option value="CALL">Call</option>
                              <option value="MEETING">Meeting</option>
                              <option value="EMAIL">Email</option>
                              <option value="WHATSAPP">WhatsApp</option>
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
                            <input type="date" value={activityForm.dueDate} onChange={(e) => setActivityForm({ ...activityForm, dueDate: e.target.value })} />
                            <button type="submit">Add</button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" id="lead-form">
        <h3>{editingId ? "Edit lead" : "New lead"}</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <input placeholder="Contact name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required style={{ flex: 1 }} />
            <input placeholder="Company" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} style={{ flex: 1 }} />
          </div>
          <div className="form-row">
            <input placeholder="Phone / WhatsApp (e.g. 05xxxxxxxx)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={{ flex: 1 }} />
            <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={{ flex: 1 }} />
            <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {PRIORITIES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <input placeholder="Project (e.g. Jubail refinery shutdown)" value={form.projectName} onChange={(e) => setForm({ ...form, projectName: e.target.value })} style={{ flex: 1 }} />
            <input placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            <select value={form.contractorGrade} onChange={(e) => setForm({ ...form, contractorGrade: e.target.value })}>
              <option value="">Contractor grade</option>
              {CONTRACTOR_GRADES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <input placeholder="Website" value={form.companyWebsite} onChange={(e) => setForm({ ...form, companyWebsite: e.target.value })} style={{ flex: 1 }} />
            <input type="number" min="0" placeholder="Est. value (SAR)" value={form.estimatedValue} onChange={(e) => setForm({ ...form, estimatedValue: e.target.value })} />
            <label className="inline-label">
              Follow-up
              <input type="date" value={form.followUpDate} onChange={(e) => setForm({ ...form, followUpDate: e.target.value })} />
            </label>
          </div>
          <div className="chip-group">
            <span className="chip-label">Services</span>
            {BUSINESS_LINES.map((b) => (
              <button
                type="button"
                key={b.id}
                className={`chip ${form.businessLines.includes(b.id) ? "on" : ""}`}
                onClick={() => setForm({ ...form, businessLines: toggle(form.businessLines, b.id) })}
              >
                {b.label}
              </button>
            ))}
          </div>
          <div className="chip-group">
            <span className="chip-label">Certs needed</span>
            {SAFETY_CERTS.map((c) => (
              <button
                type="button"
                key={c}
                className={`chip ${form.safetyCertsRequired.includes(c) ? "on" : ""}`}
                onClick={() => setForm({ ...form, safetyCertsRequired: toggle(form.safetyCertsRequired, c) })}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="form-row">
            <input placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={{ flex: 1 }} />
          </div>
          <div className="form-row" style={{ marginTop: 12 }}>
            <button type="submit" disabled={submitting || !form.name}>
              {submitting ? "Saving…" : editingId ? "Save changes" : "Create lead"}
            </button>
            {editingId && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setEditingId(null);
                  setForm(emptyForm());
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function LeadDetails({ lead }: { lead: Lead }) {
  const lines = lead.businessLines.map((id) => BUSINESS_LINES.find((b) => b.id === id)?.label ?? id);
  const rows: [string, string | null][] = [
    ["Services", lines.join(", ") || null],
    ["Certs needed", lead.safetyCertsRequired.join(", ") || null],
    ["Grade", lead.contractorGrade],
    ["Website", lead.companyWebsite],
    ["Est. value", lead.estimatedValue ? `SAR ${Number(lead.estimatedValue).toLocaleString()}` : null],
    ["AI research", lead.aiRationale ? `${lead.aiRationale}${lead.aiConfidence ? ` (${lead.aiConfidence} confidence)` : ""}` : null],
    ["Notes", lead.notes],
  ];
  const shown = rows.filter(([, v]) => v);
  if (shown.length === 0) return null;
  return (
    <dl className="lead-details">
      {shown.map(([k, v]) => (
        <Fragment key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function ActivityItem({ a }: { a: Activity }) {
  const [open, setOpen] = useState(false);
  const pending = !a.sentAt && !a.completedAt && a.dueDate && (a.type === "EMAIL" || a.type === "WHATSAPP");
  return (
    <li>
      <strong>{a.type === "WHATSAPP" ? "WhatsApp" : a.type}</strong> — {a.messageSubject ?? a.subject}
      {a.sentAt && ` · sent ${new Date(a.sentAt).toLocaleString()}${a.recipient ? ` to ${a.type === "WHATSAPP" ? "+" : ""}${a.recipient}` : ""}`}
      {pending && ` · due ${new Date(a.dueDate!).toLocaleDateString()}${a.autoSend ? " (auto-send)" : ""}`}
      {!pending && !a.sentAt && a.dueDate && ` (due ${new Date(a.dueDate).toLocaleDateString()})`}
      {!a.sentAt && a.completedAt && " ✓ done"}
      {a.sendError && <div className="followup-due">Auto-send failed: {a.sendError}</div>}
      {a.messageBody && (
        <>
          {" "}
          <button type="button" className="link-button" onClick={() => setOpen(!open)}>
            {open ? "hide message" : "show message"}
          </button>
          {open && <pre className="message-preview" dir="auto">{a.messageBody}</pre>}
        </>
      )}
      {a.notes && <div style={{ color: "#667085" }}>{a.notes}</div>}
    </li>
  );
}
