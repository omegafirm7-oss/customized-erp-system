import { useEffect, useRef, useState } from "react";
import { apiClient } from "../../api/client";
import { AgentStatus } from "./salesAgentConstants";
import { toWhatsAppNumber, whatsAppLink } from "./whatsapp";
import { copyFlyerToClipboard, fetchFlyerFile, Flyer, FlyerThumb, isTouchDevice, useFlyers } from "./flyers";

type ShareNavigator = Navigator & {
  canShare?: (data: { files?: File[]; text?: string }) => boolean;
  share?: (data: { files?: File[]; text?: string }) => Promise<void>;
};

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

  // Open with the company's default messages (Agent settings) already
  // filled in — a short one for WhatsApp, the full one for email, falling
  // back to the company profile — so a typical outreach is review-and-send.
  // {name} / {company} are swapped for this lead. Switching tabs swaps the
  // text too, unless the user has already edited it.
  const [templates, setTemplates] = useState<{ EMAIL: string; WHATSAPP: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<{
        companyProfile: string;
        defaultMessage: string | null;
        defaultWhatsappMessage: string | null;
        defaultEmailSubject: string | null;
        followUpMessage: string | null;
        followUpWhatsappMessage: string | null;
      }>("/crm/agent/settings")
      .then((res) => {
        if (cancelled) return;
        const d = res.data;
        const fill = (t: string) => t.split("{name}").join(lead.name).split("{company}").join(lead.companyName ?? lead.name);
        // A scheduled follow-up gets its own (shorter, different) text when
        // one is set; otherwise it falls back to the first-contact messages.
        const isFollowUp = !!followUpActivityId;
        const emailTpl = (isFollowUp && d.followUpMessage) || d.defaultMessage || d.companyProfile || "";
        const waTpl = (isFollowUp && (d.followUpWhatsappMessage || d.followUpMessage)) || d.defaultWhatsappMessage || emailTpl;
        setTemplates({ EMAIL: fill(emailTpl), WHATSAPP: fill(waTpl) });
        const baseSubject = fill(d.defaultEmailSubject ?? "");
        setSubject((s) => s || (isFollowUp && baseSubject ? `Re: ${baseSubject}` : baseSubject));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [lead.id]);

  useEffect(() => {
    if (!templates) return;
    setBody((b) => (b === "" || b === templates.EMAIL || b === templates.WHATSAPP ? templates[channel] : b));
  }, [templates, channel]);

  // All flyers ticked by default (max 5) until the user changes the selection.
  useEffect(() => {
    if (!flyersTouched.current) setFlyerIds(flyers.slice(0, 5).map((f) => f.id));
  }, [flyers]);

  // WhatsApp can't take files through a link. Flyers are downloaded ahead of
  // time on the WhatsApp tab so that, on phones, the share sheet can be
  // opened immediately inside the click (browsers refuse share() after a
  // slow await); on computers they're offered as copy-and-paste instead.
  const [flyerFiles, setFlyerFiles] = useState<Record<string, File>>({});
  const [pasteFlyers, setPasteFlyers] = useState<Flyer[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  useEffect(() => {
    if (channel !== "WHATSAPP") return;
    for (const f of flyers) {
      if (flyerFiles[f.id]) continue;
      fetchFlyerFile(f)
        .then((file) => setFlyerFiles((prev) => ({ ...prev, [f.id]: file })))
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, flyers]);

  const nav = navigator as ShareNavigator;
  const selectedFiles = flyerIds.map((id) => flyerFiles[id]).filter((f): f is File => !!f);
  const shareWithFiles =
    channel === "WHATSAPP" &&
    flyerIds.length > 0 &&
    selectedFiles.length === flyerIds.length &&
    !!nav.share &&
    !!nav.canShare?.({ files: selectedFiles, text: body });

  const canSend =
    body.trim().length > 0 &&
    (channel === "WHATSAPP" ? !!waNumber : !!lead.email && subject.trim().length > 0 && !!status?.emailConfigured);

  async function copyFlyer(f: Flyer) {
    setError(null);
    try {
      const file = flyerFiles[f.id] ?? (await fetchFlyerFile(f));
      await copyFlyerToClipboard(file);
      setCopiedId(f.id);
    } catch (err: any) {
      setError(err?.message ?? "Could not copy the flyer");
    }
  }

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

  // mode "web" forces WhatsApp Web (text + copy-paste flyers) on a computer
  // whose share window has no WhatsApp app in it.
  async function send(mode: "auto" | "web" = "auto") {
    setError(null);
    setNotice(null);
    const sentFlyerIds = [...flyerIds];
    const viaShare = shareWithFiles && mode === "auto";
    if (channel === "WHATSAPP") {
      if (viaShare) {
        // The OS share window (phone, or a PC/Mac with the WhatsApp app)
        // sends the text + flyer images in one go.
        try {
          await nav.share!({ files: selectedFiles, text: body });
        } catch (err: any) {
          if (err?.name === "AbortError") return; // share window closed — nothing was sent
          setError("Sharing failed — try again, or use WhatsApp Web instead");
          return;
        }
      } else {
        // Opened synchronously inside the click so the browser doesn't
        // treat it as a popup; logging happens right after.
        window.open(whatsAppLink(waNumber!, body), "_blank", "noopener");
      }
    }
    setSending(true);
    try {
      if (channel === "WHATSAPP") {
        await apiClient.post("/crm/agent/log-whatsapp", {
          leadId: lead.id,
          body,
          followUpActivityId,
          scheduleFollowUps,
          assetIds: sentFlyerIds.length ? sentFlyerIds : undefined,
        });
        if (viaShare) {
          setNotice("Shared with flyers. Logged on the lead.");
        } else if (sentFlyerIds.length > 0) {
          setPasteFlyers(flyers.filter((f) => sentFlyerIds.includes(f.id)));
          setCopiedId(null);
          setNotice("WhatsApp opened with your message. Now copy each flyer below and paste it into the chat (Ctrl+V), then press send.");
          // Keep this composer open for the copy step; the parent refreshes on Done.
          setBody("");
          setSubject("");
          return;
        } else {
          setNotice("WhatsApp opened with your message — press send there. Logged on the lead.");
        }
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

      {flyers.length > 0 && (
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
      {channel === "WHATSAPP" && flyerIds.length > 0 && (
        <p className="outreach-hint">
          {shareWithFiles
            ? isTouchDevice()
              ? `Your phone's share menu will open with the message and flyers — choose WhatsApp, then +${waNumber}.`
              : `A share window opens with the message and flyers attached — choose WhatsApp (needs the WhatsApp desktop app), then +${waNumber}. No WhatsApp app on this PC? Use "WhatsApp Web instead".`
            : isTouchDevice() && selectedFiles.length < flyerIds.length
              ? "Preparing flyers…"
              : "WhatsApp Web opens with the message; then copy each flyer here and paste it into the chat (Ctrl+V)."}
        </p>
      )}

      {channel === "WHATSAPP" && pasteFlyers.length > 0 && (
        <div className="flyer-paste">
          <strong>Paste these into the WhatsApp chat:</strong>
          <div className="flyer-grid">
            {pasteFlyers.map((f) => (
              <div key={f.id} className="flyer-card">
                <FlyerThumb flyer={f} />
                <button type="button" className={copiedId === f.id ? "secondary" : ""} onClick={() => copyFlyer(f)}>
                  {copiedId === f.id ? "Copied — paste in chat" : "Copy flyer"}
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setPasteFlyers([]);
              onSent();
            }}
          >
            Done
          </button>
        </div>
      )}

      <div className="form-row" style={{ alignItems: "center" }}>
        {!followUpActivityId && (
          <label className="outreach-check">
            <input type="checkbox" checked={scheduleFollowUps} onChange={(e) => setScheduleFollowUps(e.target.checked)} />
            Schedule follow-ups
          </label>
        )}
        <span style={{ flex: 1 }} />
        {channel === "WHATSAPP" && shareWithFiles && !isTouchDevice() && (
          <button type="button" className="secondary" onClick={() => send("web")} disabled={!canSend || sending}>
            WhatsApp Web instead
          </button>
        )}
        <button type="button" onClick={() => send()} disabled={!canSend || sending}>
          {sending ? "Sending…" : channel === "WHATSAPP" ? (shareWithFiles ? "Send on WhatsApp with flyers" : "Open in WhatsApp") : "Send email"}
        </button>
      </div>
    </div>
  );
}
