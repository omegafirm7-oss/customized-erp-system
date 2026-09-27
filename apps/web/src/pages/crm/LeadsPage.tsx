import { FormEvent, Fragment, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../../api/client";
import { OutreachComposer } from "./OutreachComposer";
import { LeadsDashboard, relativeTime, SOURCE_LABELS } from "./LeadsDashboard";
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
  lastContactedAt: string | null;
  messagesSent: number;
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
  attachmentNames: string[];
  createdAt: string;
}

const SOURCES = ["WEBSITE", "REFERRAL", "COLD_CALL", "EVENT", "AI_RESEARCH", "OTHER"];
const STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "DISQUALIFIED", "CONVERTED"];
const STATUS_LABELS: Record<string, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  CONVERTED: "Converted",
  DISQUALIFIED: "Disqualified",
};
const TABS = ["ALL", "NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "DISQUALIFIED"];

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

function initials(l: Lead) {
  const words = (l.companyName ?? l.name).replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "?") + (words[1]?.[0] ?? "")).toUpperCase();
}

const today = () => new Date().toISOString().slice(0, 10);

export function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("ALL");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [dashKey, setDashKey] = useState(0);

  // Drawer (create / edit)
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [editing, setEditing] = useState<Lead | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [messagingId, setMessagingId] = useState<string | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activityForm, setActivityForm] = useState(emptyActivity());
  const [opportunityForm, setOpportunityForm] = useState({ name: "", estimatedValue: "0" });
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);

  // Close the row "⋯" menu on any outside click.
  useEffect(() => {
    if (!menuId) return;
    const close = () => setMenuId(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuId]);

  const load = useCallback(() => {
    setLoading(true);
    setDashKey((k) => k + 1);
    return apiClient
      .get<Lead[]>("/crm/leads")
      .then((res) => setLeads(res.data))
      .catch((err) => setError(err?.response?.data?.message ?? "Failed to load leads"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    apiClient
      .get<AgentStatus>("/crm/agent/status")
      .then((res) => setAgentStatus(res.data))
      .catch(() => setAgentStatus(null));
  }, []);

  const counts: Record<string, number> = { ALL: leads.length };
  for (const l of leads) counts[l.status] = (counts[l.status] ?? 0) + 1;

  const visible = leads.filter((l) => {
    if (tab !== "ALL" && l.status !== tab) return false;
    if (priorityFilter && l.priority !== priorityFilter) return false;
    if (serviceFilter && !l.businessLines.includes(serviceFilter)) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return [l.name, l.companyName, l.email, l.phone, l.city, l.projectName].some((v) => (v ?? "").toLowerCase().includes(s));
  });

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setDrawerError(null);
    setConfirmDelete(false);
    setDrawerOpen(true);
  }

  function openEdit(l: Lead) {
    setEditing(l);
    setForm(formFromLead(l));
    setDrawerError(null);
    setConfirmDelete(false);
    setDrawerOpen(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setDrawerError(null);
    setSubmitting(true);
    try {
      if (editing) {
        await apiClient.patch(`/crm/leads/${editing.id}`, payloadFromForm(form));
      } else {
        await apiClient.post("/crm/leads", payloadFromForm(form));
      }
      setDrawerOpen(false);
      await load();
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      setDrawerError(Array.isArray(msg) ? msg.join(", ") : (msg ?? "Failed to save lead"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!editing) return;
    setSubmitting(true);
    setDrawerError(null);
    try {
      await apiClient.delete(`/crm/leads/${editing.id}`);
      setDrawerOpen(false);
      if (expandedId === editing.id) setExpandedId(null);
      if (messagingId === editing.id) setMessagingId(null);
      await load();
    } catch (err: any) {
      setDrawerError(err?.response?.data?.message ?? "Failed to delete lead");
      setConfirmDelete(false);
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

  const COLS = 8;

  return (
    <div className="crm-page">
      <div className="crm-page-head">
        <div>
          <h2>Leads</h2>
          <p>Track, contact and convert prospects — TÜV cards, training and contracting.</p>
        </div>
        <div className="crm-page-actions">
          <Link to="/crm/lead-research">
            <button type="button" className="secondary">Find leads with AI</button>
          </Link>
          <Link to="/crm/outreach">
            <button type="button" className="secondary">Follow-ups</button>
          </Link>
          <button type="button" onClick={openCreate}>
            + New lead
          </button>
        </div>
      </div>

      <LeadsDashboard
        refreshKey={dashKey}
        onStageClick={(s) => {
          setTab(s);
          document.getElementById("crm-leads-table")?.scrollIntoView({ behavior: "smooth" });
        }}
      />

      <div className="card crm-table-card" id="crm-leads-table">
        {error && <div className="error-banner">{error}</div>}
        <div className="crm-tabs">
          {TABS.map((t) => (
            <button type="button" key={t} className={`crm-tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
              {t === "ALL" ? "All leads" : STATUS_LABELS[t]}
              <span className="crm-tab-count">{counts[t] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="crm-toolbar">
          <input className="crm-search" placeholder="Search company, contact, phone, city…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
            <option value="">Any priority</option>
            {PRIORITIES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <select value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)}>
            <option value="">Any service</option>
            {BUSINESS_LINES.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
          <span className="crm-toolbar-count">
            {visible.length} of {leads.length}
          </span>
        </div>

        {loading && leads.length === 0 ? (
          <p className="crm-empty">Loading…</p>
        ) : visible.length === 0 ? (
          <div className="crm-empty-state">
            <strong>{leads.length === 0 ? "No leads yet" : "No leads match these filters"}</strong>
            <span>{leads.length === 0 ? "Add your first lead, or let the AI find contractors for you." : "Try another tab or clear the search."}</span>
            {leads.length === 0 && (
              <button type="button" onClick={openCreate}>
                + New lead
              </button>
            )}
          </div>
        ) : (
          <table className="crm-table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Contact</th>
                <th>Services</th>
                <th>Priority</th>
                <th>Stage</th>
                <th>Last contacted</th>
                <th>Next follow-up</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((l) => {
                const closed = l.status === "CONVERTED" || l.status === "DISQUALIFIED";
                const overdue = l.followUpDate && l.followUpDate.slice(0, 10) <= today();
                return (
                  <Fragment key={l.id}>
                    <tr className={expandedId === l.id || messagingId === l.id ? "crm-row-open" : undefined}>
                      <td>
                        <div className="crm-lead-cell">
                          <span className={`crm-avatar p-${l.priority.toLowerCase()}`}>{initials(l)}</span>
                          <div>
                            <button type="button" className="crm-lead-name" onClick={() => toggleActivities(l.id)}>
                              {l.companyName ?? l.name}
                            </button>
                            <div className="crm-lead-meta">
                              {[l.companyName && l.name !== l.companyName ? l.name : null, l.city, SOURCE_LABELS[l.source]].filter(Boolean).join(" · ")}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="crm-contact-cell">
                        <div>{l.phone ?? <span className="crm-muted">no phone</span>}</div>
                        <div className="crm-muted">{l.email ?? "no email"}</div>
                      </td>
                      <td>
                        <div className="crm-chips">
                          {l.businessLines.slice(0, 2).map((id) => (
                            <span key={id} className="crm-chip">
                              {BUSINESS_LINES.find((b) => b.id === id)?.label.replace("Safety Training & TUV Cards", "TÜV / Training") ?? id}
                            </span>
                          ))}
                          {l.businessLines.length > 2 && <span className="crm-chip">+{l.businessLines.length - 2}</span>}
                        </div>
                      </td>
                      <td>
                        <span className={`priority-pill ${l.priority.toLowerCase()}`}>{PRIORITIES.find((p) => p.id === l.priority)?.label ?? l.priority}</span>
                      </td>
                      <td>
                        {l.status === "CONVERTED" ? (
                          <span className="crm-stage stage-converted">Converted</span>
                        ) : (
                          <select
                            className={`crm-stage-select stage-${l.status.toLowerCase()}`}
                            value={l.status}
                            disabled={busyId === l.id}
                            onChange={(e) => updateStatus(l.id, e.target.value)}
                          >
                            {STATUSES.filter((s) => s !== "CONVERTED").map((s) => (
                              <option key={s} value={s}>
                                {STATUS_LABELS[s]}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="crm-muted">
                        {l.lastContactedAt ? (
                          <span title={new Date(l.lastContactedAt).toLocaleString()}>
                            {relativeTime(l.lastContactedAt)}
                            {l.messagesSent > 1 && ` · ${l.messagesSent} msgs`}
                          </span>
                        ) : (
                          "Never"
                        )}
                      </td>
                      <td>
                        {l.followUpDate && !closed ? (
                          <span className={overdue ? "followup-due" : undefined}>{new Date(l.followUpDate).toLocaleDateString()}</span>
                        ) : (
                          <span className="crm-muted">—</span>
                        )}
                      </td>
                      <td className="crm-actions-cell">
                        {!closed && (
                          <button
                            type="button"
                            onClick={() => {
                              setMessagingId(messagingId === l.id ? null : l.id);
                              setExpandedId(null);
                              setConvertingId(null);
                            }}
                          >
                            Message
                          </button>
                        )}
                        <span className="crm-menu-wrap">
                          <button
                            type="button"
                            className="secondary crm-menu-btn"
                            aria-label="More actions"
                            aria-expanded={menuId === l.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuId(menuId === l.id ? null : l.id);
                            }}
                          >
                            ⋯
                          </button>
                          {menuId === l.id && (
                            <span className="crm-menu" role="menu" onClick={() => setMenuId(null)}>
                              <button type="button" role="menuitem" onClick={() => toggleActivities(l.id)}>
                                History &amp; details
                              </button>
                              {l.status !== "CONVERTED" && (
                                <button type="button" role="menuitem" onClick={() => openEdit(l)}>
                                  Edit lead
                                </button>
                              )}
                              {l.status === "QUALIFIED" && (
                                <button
                                  type="button"
                                  role="menuitem"
                                  disabled={busyId === l.id}
                                  onClick={() => {
                                    setConvertingId(convertingId === l.id ? null : l.id);
                                    setExpandedId(null);
                                    setMessagingId(null);
                                    setOpportunityForm({ name: l.companyName ?? l.name, estimatedValue: l.estimatedValue ? String(Number(l.estimatedValue)) : "0" });
                                  }}
                                >
                                  Convert to opportunity
                                </button>
                              )}
                            </span>
                          )}
                        </span>
                      </td>
                    </tr>
                    {messagingId === l.id && (
                      <tr className="crm-subrow">
                        <td colSpan={COLS}>
                          <OutreachComposer lead={l} status={agentStatus} onSent={() => load()} onClose={() => setMessagingId(null)} />
                        </td>
                      </tr>
                    )}
                    {convertingId === l.id && (
                      <tr className="crm-subrow">
                        <td colSpan={COLS}>
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
                      <tr className="crm-subrow">
                        <td colSpan={COLS}>
                          <div className="crm-detail">
                            <LeadDetails lead={l} />
                            <h4>History</h4>
                            {activities.length === 0 ? (
                              <p className="crm-muted">No activities logged yet.</p>
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
                                placeholder="Log a call, meeting or note…"
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
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {drawerOpen && (
        <div className="crm-drawer-backdrop" onClick={() => !submitting && setDrawerOpen(false)}>
          <aside className="crm-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={editing ? "Edit lead" : "New lead"}>
            <header className="crm-drawer-head">
              <h3>{editing ? `Edit ${editing.companyName ?? editing.name}` : "New lead"}</h3>
              <button type="button" className="secondary" onClick={() => setDrawerOpen(false)} disabled={submitting}>
                Close
              </button>
            </header>
            <form onSubmit={handleSubmit} className="crm-drawer-body">
              {drawerError && <div className="error-banner">{drawerError}</div>}
              <fieldset>
                <legend>Contact</legend>
                <label>
                  Contact name *
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                </label>
                <label>
                  Company
                  <input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
                </label>
                <div className="crm-grid2">
                  <label>
                    Phone / WhatsApp
                    <input placeholder="05xxxxxxxx" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                  </label>
                  <label>
                    Email
                    <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  </label>
                </div>
              </fieldset>

              <fieldset>
                <legend>Qualification</legend>
                <div className="crm-grid2">
                  <label>
                    Priority
                    <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                      {PRIORITIES.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Source
                    <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                      {SOURCES.map((s) => (
                        <option key={s} value={s}>
                          {SOURCE_LABELS[s] ?? s}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    City
                    <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                  </label>
                  <label>
                    Contractor grade
                    <select value={form.contractorGrade} onChange={(e) => setForm({ ...form, contractorGrade: e.target.value })}>
                      <option value="">—</option>
                      {CONTRACTOR_GRADES.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Est. value (SAR)
                    <input type="number" min="0" value={form.estimatedValue} onChange={(e) => setForm({ ...form, estimatedValue: e.target.value })} />
                  </label>
                  <label>
                    Follow-up date
                    <input type="date" value={form.followUpDate} onChange={(e) => setForm({ ...form, followUpDate: e.target.value })} />
                  </label>
                </div>
                <label>
                  Project
                  <input placeholder="e.g. Jubail refinery shutdown" value={form.projectName} onChange={(e) => setForm({ ...form, projectName: e.target.value })} />
                </label>
                <label>
                  Website
                  <input value={form.companyWebsite} onChange={(e) => setForm({ ...form, companyWebsite: e.target.value })} />
                </label>
              </fieldset>

              <fieldset>
                <legend>Services of interest</legend>
                <div className="chip-group">
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
              </fieldset>

              <fieldset>
                <legend>Certificates needed</legend>
                <div className="chip-group">
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
              </fieldset>

              <fieldset>
                <legend>Notes</legend>
                <textarea className="outreach-body" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </fieldset>

              <footer className="crm-drawer-foot">
                {editing &&
                  (confirmDelete ? (
                    <span className="crm-delete-confirm">
                      Delete this lead and its history?
                      <button type="button" className="danger" onClick={handleDelete} disabled={submitting}>
                        Yes, delete
                      </button>
                      <button type="button" className="secondary" onClick={() => setConfirmDelete(false)} disabled={submitting}>
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="danger" onClick={() => setConfirmDelete(true)} disabled={submitting}>
                      Delete lead
                    </button>
                  ))}
                <span style={{ flex: 1 }} />
                <button type="button" className="secondary" onClick={() => setDrawerOpen(false)} disabled={submitting}>
                  Cancel
                </button>
                <button type="submit" disabled={submitting || !form.name}>
                  {submitting ? "Saving…" : editing ? "Save changes" : "Create lead"}
                </button>
              </footer>
            </form>
          </aside>
        </div>
      )}
    </div>
  );
}

function LeadDetails({ lead }: { lead: Lead }) {
  const lines = lead.businessLines.map((id) => BUSINESS_LINES.find((b) => b.id === id)?.label ?? id);
  const rows: [string, string | null][] = [
    ["Services", lines.join(", ") || null],
    ["Certs needed", lead.safetyCertsRequired.join(", ") || null],
    ["Project", lead.projectName],
    ["Grade", lead.contractorGrade],
    ["Website", lead.companyWebsite],
    ["Est. value", lead.estimatedValue ? `SAR ${Number(lead.estimatedValue).toLocaleString()}` : null],
    ["AI research", lead.aiRationale ? `${lead.aiRationale}${lead.aiConfidence ? ` (${lead.aiConfidence} confidence)` : ""}` : null],
    ["Notes", lead.notes],
    ["Added", new Date(lead.createdAt).toLocaleDateString()],
  ];
  const shown = rows.filter(([, v]) => v);
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
      <strong>{a.type === "WHATSAPP" ? "WhatsApp" : a.type.charAt(0) + a.type.slice(1).toLowerCase()}</strong> — {a.messageSubject ?? a.subject}
      {a.sentAt && ` · sent ${new Date(a.sentAt).toLocaleString()}${a.recipient ? ` to ${a.type === "WHATSAPP" ? "+" : ""}${a.recipient}` : ""}`}
      {pending && ` · due ${new Date(a.dueDate!).toLocaleDateString()}${a.autoSend ? " (auto-send)" : ""}`}
      {!pending && !a.sentAt && a.dueDate && ` (due ${new Date(a.dueDate).toLocaleDateString()})`}
      {!a.sentAt && a.completedAt && " ✓ done"}
      {a.sendError && <div className="followup-due">Auto-send failed: {a.sendError}</div>}
      {a.attachmentNames?.length > 0 && <div className="lead-sub">Flyers: {a.attachmentNames.join(", ")}</div>}
      {a.messageBody && (
        <>
          {" "}
          <button type="button" className="link-button" onClick={() => setOpen(!open)}>
            {open ? "hide message" : "show message"}
          </button>
          {open && (
            <pre className="message-preview" dir="auto">
              {a.messageBody}
            </pre>
          )}
        </>
      )}
      {a.notes && <div style={{ color: "#667085" }}>{a.notes}</div>}
    </li>
  );
}
