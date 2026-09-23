import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../../api/client";
import { AgentStatus, BUSINESS_LINES, CITIES, TARGET_TYPES } from "./salesAgentConstants";

interface ResearchedLead {
  companyName: string;
  activity: string;
  location: string;
  phone: string;
  email: string;
  website: string;
  whyTheyNeedUs: string;
  howToReach: string;
  confidence: string;
  notes: string;
}

/** AI web research for new leads; nothing is saved until the user picks leads to add. */
export function LeadResearchPage() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [service, setService] = useState("training");
  const [targetType, setTargetType] = useState(TARGET_TYPES[0]);
  const [city, setCity] = useState("Dammam");
  const [extra, setExtra] = useState("");
  const [results, setResults] = useState<ResearchedLead[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<AgentStatus>("/crm/agent/status")
      .then((res) => setStatus(res.data))
      .catch(() => setStatus(null));
  }, []);

  const serviceLabel = BUSINESS_LINES.find((b) => b.id === service)?.label ?? service;

  async function run(append: boolean) {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiClient.post<{ leads: ResearchedLead[] }>(
        "/crm/agent/research",
        {
          service: service === "training" ? "Safety training & TUV cards (TVTC-accredited)" : serviceLabel,
          targetType,
          city,
          extraCriteria: extra || undefined,
          excludeCompanies: append ? results.map((r) => r.companyName) : undefined,
        },
        // Live web research takes 30-90 seconds.
        { timeout: 300_000 },
      );
      const fresh = res.data.leads;
      setResults((prev) => (append ? [...prev, ...fresh.filter((f) => !prev.some((p) => p.companyName === f.companyName))] : fresh));
      if (!append) {
        setSelected(new Set());
        setSaved(new Set());
      }
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Research failed — please retry");
    } finally {
      setLoading(false);
    }
  }

  async function saveSelected() {
    const leads = results.filter((r) => selected.has(r.companyName) && !saved.has(r.companyName));
    if (leads.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.post<{ created: number }>("/crm/agent/import", { leads, city, businessLines: [service] });
      setSaved((prev) => new Set([...prev, ...leads.map((l) => l.companyName)]));
      setSelected(new Set());
      setNotice(`${res.data.created} lead${res.data.created === 1 ? "" : "s"} added to CRM Leads.`);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to save leads");
    } finally {
      setSaving(false);
    }
  }

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <div>
      <div className="card">
        <h2>Find leads with AI</h2>
        <p className="outreach-hint">
          The agent searches the live web for real companies that match, then you choose which ones to add to your Leads. Contacts it can't find published are marked "not listed" — it never makes them up.
        </p>
        {status && !status.aiConfigured && (
          <div className="error-banner">
            AI research isn't switched on yet: the server needs an Anthropic API key (ANTHROPIC_API_KEY). Everything else in CRM works without it.
          </div>
        )}
        {error && <div className="error-banner">{error}</div>}
        {notice && (
          <div className="outreach-notice">
            {notice} <Link to="/crm/leads">Open Leads</Link>
          </div>
        )}
        <div className="form-row">
          <label className="inline-label">
            Selling
            <select value={service} onChange={(e) => setService(e.target.value)}>
              {BUSINESS_LINES.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-label">
            Target
            <select value={targetType} onChange={(e) => setTargetType(e.target.value)}>
              {TARGET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-label">
            City
            <select value={city} onChange={(e) => setCity(e.target.value)}>
              {CITIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-row">
          <input
            placeholder="Extra criteria (optional), e.g. contractors on Aramco shutdown projects, 100+ workers"
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            style={{ flex: 1 }}
          />
        </div>
        <div className="form-row" style={{ marginTop: 10 }}>
          <button type="button" onClick={() => run(false)} disabled={loading || !status?.aiConfigured}>
            {loading ? "Researching (up to a minute or two)…" : "Run research"}
          </button>
          {results.length > 0 && (
            <button type="button" className="secondary" onClick={() => run(true)} disabled={loading}>
              Find more (different companies)
            </button>
          )}
        </div>
      </div>

      {results.length > 0 && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ margin: 0 }}>
              {results.length} compan{results.length === 1 ? "y" : "ies"} found
            </h3>
            <button type="button" onClick={saveSelected} disabled={saving || selected.size === 0}>
              {saving ? "Saving…" : `Add ${selected.size || ""} selected to Leads`}
            </button>
          </div>
          {results.map((r) => {
            const isSaved = saved.has(r.companyName);
            return (
              <div key={r.companyName} className={`research-card conf-${r.confidence.toLowerCase()}`}>
                <label className="research-head">
                  <input type="checkbox" disabled={isSaved} checked={isSaved || selected.has(r.companyName)} onChange={() => toggle(r.companyName)} />
                  <strong>{r.companyName}</strong>
                  <span className={`conf-pill conf-${r.confidence.toLowerCase()}`}>{r.confidence}</span>
                  {isSaved && <span className="badge posted">Added</span>}
                </label>
                {r.activity && <div className="lead-sub">{r.activity}</div>}
                <div className="research-grid">
                  <span>Location: {r.location || "—"}</span>
                  <span>Website: {r.website || "—"}</span>
                  <span>Phone: {r.phone || "not listed"}</span>
                  <span>Email: {r.email || "not listed"}</span>
                </div>
                {r.whyTheyNeedUs && (
                  <div className="research-why">
                    <strong>Why they need us:</strong> {r.whyTheyNeedUs}
                  </div>
                )}
                {r.howToReach && (
                  <div className="lead-sub">
                    <strong>How to reach:</strong> {r.howToReach}
                  </div>
                )}
                {r.notes && <div className="lead-sub">{r.notes}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
