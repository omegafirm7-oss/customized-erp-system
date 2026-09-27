import { useEffect, useRef, useState } from "react";
import { apiClient } from "../../api/client";
import { AgentStatus } from "./salesAgentConstants";
import { toWhatsAppNumber, whatsAppLink } from "./whatsapp";
import { FlyerThumb, useFlyers } from "./flyers";

export interface OutreachLead {
  id: string;
  name: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
}

interface Props {
  lead: OutreachLead;
  status: AgentStatus | null;
  /** Set when this composer is sending a scheduled follow-up. */
  followUpActivityId?: string;
  initialChannel?: "WHATSAPP" | "EMAIL";
  onSent: () => void;
  onClose?: () => void;
}

/**
 * Draft (optionally with AI), review, then send one outreach message.
 * WhatsApp is click-to-send: wa.me opens with the text and the user presses
 * send in WhatsApp; the message is logged on the lead at the same time.
 */
export function OutreachComposer({ lead, status, followUpActivityId, initialChannel, onSent, onClose }: Props) {
  const waNumber = toWhatsAppNumber(lead.phone);
  const [channel, setChannel] = useState<"WHATSAPP" | "EMAIL">(initialChannel ?? (waNumber ? "WHATSAPP" : "EMAIL"));
  const [language, setLanguage] = useState("");
  const [instructions, setInstructions] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [scheduleFollowUps, setScheduleFollowUps] = useState(!followUpActivityId);
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { flyers } = useFlyers();
  const [flyerIds, setFlyerIds] = useState<string[]>([]);
  const flyersTouched = useRef(false);

  // Open with the company's default message (Agent settings) already filled
  // in — falling back to the company profile — so a typical outreach is
  // review-and-send. {name} / {company} are swapped for this lead.
  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<{ companyProfile: string; defaultMessage: string | null; defaultEmailSubject: string | null }>("/crm/agent/settings")
      .then((res) => {
        if (cancelled) return;
        const fill = (t: string) => t.split("{name}").join(lead.name).split("{company}").join(lead.companyName ?? lead.name);
        const template = res.data.defaultMessage || res.data.companyProfile;
        setBody((b) => b || fill(template ?? ""));
        setSubject((s) => s || fill(res.data.defaultEmailSubject ?? ""));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [lead.id]);

  // All flyers ticked by default (max 5) until the user changes the selection.
  useEffect(() => {
    if (!flyersTouched.current) setFlyerIds(flyers.slice(0, 5).map((f) => f.id));
  }, [flyers]);

  const canSend =
    body.trim().length > 0 &&
    (channel === "WHATSAPP" ? !!waNumber : !!lead.email && subject.trim().length > 0 && !!status?.emailConfigured);

  async function draft() {
    setDrafting(true);
    setError(null);
    try {
      const res = await apiClient.post<{ subject: string; body: string }>("/crm/agent/draft", {
        leadId: lead.id,
        channel,
        purpose: followUpActivityId ? "FOLLOW_UP" : undefined,
        language: language || undefined,
        extraInstructions: instructions || undefined,
      });
      setBody(res.data.body);
      if (channel === "EMAIL") setSubject(res.data.subject);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "The AI could not draft a message");
    } finally {
      setDrafting(false);
    }
  }

  async function send() {
    setError(null);
    setNotice(null);
    if (channel === "WHATSAPP") {
      // Opened synchronously inside the click so the browser doesn't treat
      // it as a popup; logging happens right after.
      window.open(whatsAppLink(waNumber!, body), "_blank", "noopener");
    }
    setSending(true);
    try {
      if (channel === "WHATSAPP") {
        await apiClient.post("/crm/agent/log-whatsapp", { leadId: lead.id, body, followUpActivityId, scheduleFollowUps });
        setNotice("WhatsApp opened with your message — press send there. Logged on the lead.");
      } else {
        await apiClient.post("/crm/agent/send-email", {
          leadId: lead.id,
          subject,
          body,
          followUpActivityId,
          scheduleFollowUps,
          assetIds: flyerIds.length ? flyerIds : undefined,
        });
        setNotice(`Email sent to ${lead.email}.`);
      }
      setBody("");
      setSubject("");
      setFlyerIds([]);
      onSent();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to send");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="outreach-composer">
      <div className="outreach-composer-head">
        <strong>
          {followUpActivityId ? "Follow-up" : "Message"} {lead.companyName ?? lead.name}
        </strong>
        {onClose && (
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
        )}
      </div>
      {error && <div className="error-banner">{error}</div>}
      {notice && <div className="outreach-notice">{notice}</div>}

      <div className="tab-row">
        <button type="button" className={channel === "WHATSAPP" ? "" : "secondary"} onClick={() => setChannel("WHATSAPP")}>
          WhatsApp {waNumber ? `(+${waNumber})` : "(no phone)"}
        </button>
        <button type="button" className={channel === "EMAIL" ? "" : "secondary"} onClick={() => setChannel("EMAIL")}>
          Email {lead.email ? `(${lead.email})` : "(no email)"}
        </button>
      </div>

      {channel === "EMAIL" && status && !status.emailConfigured && (
        <p className="outreach-hint">Email sending isn't set up on the server yet (Microsoft 365 SMTP settings). You can still draft here.</p>
      )}

      {status?.aiConfigured ? (
        <div className="form-row">
          <select value={language} onChange={(e) => setLanguage(e.target.value)} title="Language">
            <option value="">Default language</option>
            <option value="en">English</option>
            <option value="ar">Arabic</option>
            <option value="both">English + Arabic</option>
          </select>
          <input
            placeholder="Optional guidance, e.g. mention 15% off for 10+ workers"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            style={{ flex: 1 }}
          />
          <button type="button" onClick={draft} disabled={drafting}>
            {drafting ? "Drafting…" : body ? "Redraft with AI" : "Draft with AI"}
          </button>
        </div>
      ) : (
        <p className="outreach-hint">AI drafting turns on once the Anthropic API key is added on the server. Write the message yourself for now.</p>
      )}

      {channel === "EMAIL" && (
        <div className="form-row">
          <input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} style={{ flex: 1 }} />
        </div>
      )}
      <textarea
        className="outreach-body"
        rows={channel === "WHATSAPP" ? 6 : 10}
        placeholder={channel === "WHATSAPP" ? "WhatsApp message…" : "Email body (your signature is added automatically)…"}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        dir="auto"
      />

      {channel === "EMAIL" && flyers.length > 0 && (
        <div className="flyer-pick">
          <span className="chip-label">Include flyers (up to 5)</span>
          <div className="flyer-grid">
            {flyers.map((f) => {
              const on = flyerIds.includes(f.id);
              return (
                <label key={f.id} className={`flyer-card ${on ? "on" : ""}`} title={f.fileName}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!on && flyerIds.length >= 5}
                    onChange={() => {
                      flyersTouched.current = true;
                      setFlyerIds(on ? flyerIds.filter((id) => id !== f.id) : [...flyerIds, f.id]);
                    }}
                  />
                  <FlyerThumb flyer={f} />
                </label>
              );
            })}
          </div>
        </div>
      )}
      {channel === "WHATSAPP" && flyers.length > 0 && (
        <p className="outreach-hint">WhatsApp links can only carry text. To send a flyer on WhatsApp, attach the image in WhatsApp after it opens.</p>
      )}

      <div className="form-row" style={{ alignItems: "center" }}>
        {!followUpActivityId && (
          <label className="outreach-check">
            <input type="checkbox" checked={scheduleFollowUps} onChange={(e) => setScheduleFollowUps(e.target.checked)} />
            Schedule follow-ups
          </label>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" onClick={send} disabled={!canSend || sending}>
          {sending ? "Sending…" : channel === "WHATSAPP" ? "Open in WhatsApp" : "Send email"}
        </button>
      </div>
    </div>
  );
}
