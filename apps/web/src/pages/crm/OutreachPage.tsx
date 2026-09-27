import { FormEvent, Fragment, useCallback, useEffect, useState } from "react";
import { apiClient } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { useCompanies } from "../../hooks/useCompanies";
import { OutreachComposer, OutreachLead } from "./OutreachComposer";
import { AgentStatus, TUV_PROFILE_TEMPLATE } from "./salesAgentConstants";
import { FlyerLibrary } from "./flyers";

interface FollowUp {
  id: string;
  type: "EMAIL" | "WHATSAPP";
  subject: string;
  dueDate: string;
  autoSend: boolean;
  sendError: string | null;
  lead: OutreachLead & { status: string; priority: string };
}

interface Settings {
  companyProfile: string;
  emailSignature: string | null;
  replyToEmail: string | null;
  whatsappNumber: string | null;
  defaultLanguage: string;
  followUpDays: string;
  autoSendEmailFollowUps: boolean;
  defaultEmailSubject: string | null;
  defaultMessage: string | null;
  updatedAt: string | null;
}

const endOfToday = () => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
};

/** Follow-ups due across all leads, plus the agent settings the AI and emails use. */
export function OutreachPage() {
  const { user } = useAuth();
  const { companies } = useCompanies();
  const companyName = companies.find((c) => c.companyId === user?.activeCompanyId)?.companyName ?? "Our company";
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadFollowUps = useCallback(() => {
    return apiClient
      .get<FollowUp[]>("/crm/agent/follow-ups")
      .then((res) => setFollowUps(res.data))
      .catch((err) => setError(err?.response?.data?.message ?? "Failed to load follow-ups"));
  }, []);

  useEffect(() => {
    loadFollowUps();
    apiClient.get<AgentStatus>("/crm/agent/status").then((res) => setStatus(res.data)).catch(() => setStatus(null));
    apiClient
      .get<Settings>("/crm/agent/settings")
      .then((res) => setSettings(res.data))
      .catch((err) => setError(err?.response?.data?.message ?? "Failed to load agent settings"));
  }, [loadFollowUps]);

  async function dismiss(id: string) {
    setError(null);
    try {
      await apiClient.patch(`/crm/activities/${id}`, { completed: true });
      await loadFollowUps();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to dismiss follow-up");
    }
  }

  async function saveSettings(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setSavingSettings(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiClient.put<Settings>("/crm/agent/settings", {
        companyProfile: settings.companyProfile,
        emailSignature: settings.emailSignature ?? "",
        replyToEmail: settings.replyToEmail ?? "",
        whatsappNumber: settings.whatsappNumber ?? "",
        defaultLanguage: settings.defaultLanguage,
        followUpDays: settings.followUpDays,
        autoSendEmailFollowUps: settings.autoSendEmailFollowUps,
        defaultEmailSubject: settings.defaultEmailSubject ?? "",
        defaultMessage: settings.defaultMessage ?? "",
      });
      setSettings(res.data);
      setNotice("Agent settings saved.");
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(", ") : (msg ?? "Failed to save settings"));
    } finally {
      setSavingSettings(false);
    }
  }

  const cutoff = endOfToday();
  const due = followUps.filter((f) => new Date(f.dueDate) <= cutoff);
  const upcoming = followUps.filter((f) => new Date(f.dueDate) > cutoff);

  function renderRows(rows: FollowUp[]) {
    return rows.map((f) => (
      <Fragment key={f.id}>
        <tr>
          <td>
            <strong>{f.lead.companyName ?? f.lead.name}</strong>
            <div className="lead-sub">{f.lead.name}</div>
          </td>
          <td>{f.type === "WHATSAPP" ? "WhatsApp" : "Email"}</td>
          <td>{f.subject}</td>
          <td>
            <span className={new Date(f.dueDate) <= cutoff ? "followup-due" : undefined}>{new Date(f.dueDate).toLocaleDateString()}</span>
            {f.autoSend && <div className="lead-sub">auto-sends</div>}
            {f.sendError && <div className="followup-due">Auto-send failed: {f.sendError}</div>}
          </td>
          <td style={{ whiteSpace: "nowrap" }}>
            <button type="button" onClick={() => setOpenId(openId === f.id ? null : f.id)}>
              Send now
            </button>{" "}
            <button type="button" className="secondary" onClick={() => dismiss(f.id)}>
              Skip
            </button>
          </td>
        </tr>
        {openId === f.id && (
          <tr>
            <td colSpan={5}>
              <OutreachComposer
                lead={f.lead}
                status={status}
                followUpActivityId={f.id}
                initialChannel={f.type}
                onSent={() => {
                  setOpenId(null);
                  loadFollowUps();
                }}
                onClose={() => setOpenId(null)}
              />
            </td>
          </tr>
        )}
      </Fragment>
    ));
  }

  return (
    <div>
      <div className="card">
        <h2>Outreach & follow-ups</h2>
        {status && (
          <div className="agent-status">
            <span className={status.aiConfigured ? "status-ok" : "status-off"}>AI agent: {status.aiConfigured ? "on" : "off (no API key on server)"}</span>
            <span className={status.emailConfigured ? "status-ok" : "status-off"}>Email sending: {status.emailConfigured ? "on" : "off (SMTP not set up)"}</span>
            <span className="status-ok">WhatsApp: click-to-send</span>
          </div>
        )}
        {error && <div className="error-banner">{error}</div>}
        {notice && <div className="outreach-notice">{notice}</div>}

        <h3>Due today or overdue ({due.length})</h3>
        {due.length === 0 ? (
          <p className="outreach-hint">Nothing due. Follow-ups are scheduled when you send a first message with "Schedule follow-ups" ticked.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Lead</th>
                <th>Channel</th>
                <th>Step</th>
                <th>Due</th>
                <th></th>
              </tr>
            </thead>
            <tbody>{renderRows(due)}</tbody>
          </table>
        )}

        {upcoming.length > 0 && (
          <>
            <h3 style={{ marginTop: 24 }}>Upcoming ({upcoming.length})</h3>
            <table>
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Channel</th>
                  <th>Step</th>
                  <th>Due</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>{renderRows(upcoming)}</tbody>
            </table>
          </>
        )}
      </div>

      <FlyerLibrary />

      {settings && (
        <div className="card">
          <h3>Agent settings</h3>
          <form onSubmit={saveSettings}>
            <label className="block-label">
              Company profile: the only facts the AI will state (services, accreditation, prices, batch dates, contact)
              <textarea
                rows={12}
                className="outreach-body"
                value={settings.companyProfile}
                onChange={(e) => setSettings({ ...settings, companyProfile: e.target.value })}
                dir="auto"
              />
            </label>
            <button
              type="button"
              className="secondary"
              onClick={() => setSettings({ ...settings, companyProfile: TUV_PROFILE_TEMPLATE(companyName) })}
            >
              Fill in the TUV training template
            </button>
            <label className="block-label" style={{ marginTop: 14 }}>
              Default email subject (filled in when you click Message)
              <input
                className="outreach-body"
                value={settings.defaultEmailSubject ?? ""}
                onChange={(e) => setSettings({ ...settings, defaultEmailSubject: e.target.value })}
                placeholder="e.g. TÜV cards & safety training for your crew"
              />
            </label>
            <label className="block-label" style={{ marginTop: 8 }}>
              Default message (filled in when you click Message; {"{name}"} and {"{company}"} are replaced with the lead's details). Leave empty to use the company profile.
              <textarea
                rows={10}
                className="outreach-body"
                value={settings.defaultMessage ?? ""}
                onChange={(e) => setSettings({ ...settings, defaultMessage: e.target.value })}
                placeholder={"Dear {name},\n\n…"}
                dir="auto"
              />
            </label>
            <label className="block-label" style={{ marginTop: 14 }}>
              Email signature (added to every email)
              <textarea
                rows={4}
                className="outreach-body"
                value={settings.emailSignature ?? ""}
                onChange={(e) => setSettings({ ...settings, emailSignature: e.target.value })}
                placeholder={"Best regards,\nName\nSales — Company\n+966 5x xxx xxxx"}
              />
            </label>
            <div className="form-row">
              <label className="inline-label">
                Reply-to email
                <input
                  type="email"
                  value={settings.replyToEmail ?? ""}
                  onChange={(e) => setSettings({ ...settings, replyToEmail: e.target.value })}
                  placeholder="sales@yourcompany.com"
                />
              </label>
              <label className="inline-label">
                Default language
                <select value={settings.defaultLanguage} onChange={(e) => setSettings({ ...settings, defaultLanguage: e.target.value })}>
                  <option value="en">English</option>
                  <option value="ar">Arabic</option>
                  <option value="both">English + Arabic</option>
                </select>
              </label>
              <label className="inline-label">
                Follow-up after (days)
                <input value={settings.followUpDays} onChange={(e) => setSettings({ ...settings, followUpDays: e.target.value })} placeholder="3,7" style={{ width: 90 }} />
              </label>
            </div>
            <label className="outreach-check" style={{ marginTop: 8 }}>
              <input
                type="checkbox"
                checked={settings.autoSendEmailFollowUps}
                onChange={(e) => setSettings({ ...settings, autoSendEmailFollowUps: e.target.checked })}
              />
              Send email follow-ups automatically when due (WhatsApp follow-ups always need you to press send). They stop as soon as the lead is marked Qualified or Disqualified.
            </label>
            <div className="form-row" style={{ marginTop: 12 }}>
              <button type="submit" disabled={savingSettings || !settings.companyProfile.trim()}>
                {savingSettings ? "Saving…" : "Save settings"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
