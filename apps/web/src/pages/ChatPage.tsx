import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { apiClient } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { AttachmentViewer } from "../components/AttachmentViewer";

interface Channel {
  id: string;
  kind: "CHANNEL" | "DIRECT";
  name: string;
  isPrivate: boolean;
  memberCount: number;
  otherUserId: string | null;
  createdByMe: boolean;
  unread: number;
  lastMessageAt: string;
  lastMessage: { preview: string; senderName: string; createdAt: string } | null;
}

interface Person {
  id: string;
  name: string;
  email: string;
}

interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

interface Message {
  id: string;
  senderUserId: string;
  senderName: string;
  body: string;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
  attachment: Attachment | null;
}

interface Details {
  id: string;
  kind: "CHANNEL" | "DIRECT";
  name: string;
  isPrivate: boolean;
  createdByMe: boolean;
  members: Array<{ id: string; name: string }>;
}

const POLL_MS = 3000;

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function Clip() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: "-2px" }}>
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function Lock() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: "-2px" }}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

/** Image attachments show inline; the file route needs the login token, so they are fetched as blobs. */
function ChatImage({ attachment, onOpen }: { attachment: Attachment; onOpen: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    apiClient
      .get(`/chat/attachments/${attachment.id}`, { responseType: "blob" })
      .then((res) => {
        if (!alive) return;
        url = URL.createObjectURL(res.data as Blob);
        setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [attachment.id]);
  if (!src) return <div className="chat-image-loading">Loading image…</div>;
  return <img className="chat-image" src={src} alt={attachment.filename} onClick={onOpen} />;
}

export function ChatPage() {
  const { user } = useAuth();
  const me = user?.sub ?? "";
  const [channels, setChannels] = useState<Channel[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showList, setShowList] = useState(true);
  const [modal, setModal] = useState<null | "channel" | "direct" | "members">(null);
  const [viewer, setViewer] = useState<Attachment | null>(null);
  const [newName, setNewName] = useState("");
  const [newPrivate, setNewPrivate] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [personFilter, setPersonFilter] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const cursor = useRef<string | null>(null); // newest updatedAt seen in the open conversation
  const fileInput = useRef<HTMLInputElement>(null);

  const announceUnread = () => window.dispatchEvent(new Event("chat:unread"));

  const loadChannels = useCallback(async () => {
    try {
      const res = await apiClient.get<Channel[]>("/chat/channels");
      setChannels(res.data);
      return res.data;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    loadChannels().then((list) => {
      if (list && list.length > 0 && window.innerWidth > 800) openChannel(list[0].id);
    });
    apiClient.get<Person[]>("/chat/people").then((res) => setPeople(res.data)).catch(() => undefined);
    const t = setInterval(() => {
      if (!document.hidden) loadChannels();
    }, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function mergeMessages(incoming: Message[]) {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, m);
      return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
    for (const m of incoming) {
      if (!cursor.current || m.updatedAt > cursor.current) cursor.current = m.updatedAt;
    }
  }

  async function openChannel(id: string) {
    setActiveId(id);
    setShowList(false);
    setMessages([]);
    setDetails(null);
    setError(null);
    setFile(null);
    setDraft("");
    cursor.current = null;
    nearBottom.current = true;
    try {
      const [msgs, det] = await Promise.all([
        apiClient.get<{ messages: Message[]; hasMore: boolean }>(`/chat/channels/${id}/messages`),
        apiClient.get<Details>(`/chat/channels/${id}`),
      ]);
      setMessages(msgs.data.messages);
      setHasMore(msgs.data.hasMore);
      setDetails(det.data);
      cursor.current = msgs.data.messages.reduce<string | null>((max, m) => (!max || m.updatedAt > max ? m.updatedAt : max), null) ?? new Date(0).toISOString();
      await apiClient.post(`/chat/channels/${id}/read`);
      loadChannels();
      announceUnread();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Couldn't open this conversation");
    }
  }

  // Live updates: the open conversation asks for anything created or deleted since the last look.
  useEffect(() => {
    if (!activeId) return;
    let tick = 0;
    const t = setInterval(async () => {
      tick += 1;
      if (document.hidden && tick % 5 !== 0) return;
      if (!cursor.current) return;
      try {
        const res = await apiClient.get<{ messages: Message[] }>(`/chat/channels/${activeId}/messages`, { params: { changedAfter: cursor.current } });
        if (res.data.messages.length > 0) {
          mergeMessages(res.data.messages);
          if (res.data.messages.some((m) => m.senderUserId !== me && !m.deleted) && !document.hidden) {
            apiClient.post(`/chat/channels/${activeId}/read`).then(() => announceUnread()).catch(() => undefined);
          }
          loadChannels();
        }
      } catch {
        // a dropped poll is retried on the next tick
      }
    }, POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, me]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function onScroll() {
    const el = scrollRef.current;
    if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  async function loadEarlier() {
    if (!activeId || messages.length === 0) return;
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    const res = await apiClient.get<{ messages: Message[]; hasMore: boolean }>(`/chat/channels/${activeId}/messages`, { params: { before: messages[0].createdAt } });
    nearBottom.current = false;
    setMessages((prev) => [...res.data.messages, ...prev]);
    setHasMore(res.data.hasMore);
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - prevHeight;
    });
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (!activeId || sending || (!draft.trim() && !file)) return;
    setSending(true);
    setError(null);
    try {
      const form = new FormData();
      if (draft.trim()) form.append("body", draft.trim());
      if (file) form.append("file", file);
      // Don't set Content-Type: the browser must generate the multipart boundary itself.
      const res = await apiClient.post<Message>(`/chat/channels/${activeId}/messages`, form);
      nearBottom.current = true;
      mergeMessages([res.data]);
      setDraft("");
      setFile(null);
      loadChannels();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Couldn't send. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function pickFile(f: File | null) {
    if (f && f.size > 5 * 1024 * 1024) {
      setError("Files can be at most 5 MB");
      return;
    }
    setError(null);
    setFile(f);
  }

  async function removeMessage(id: string) {
    if (!window.confirm("Delete this message for everyone?")) return;
    try {
      await apiClient.delete(`/chat/messages/${id}`);
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, deleted: true, body: "", attachment: null } : m)));
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Couldn't delete the message");
    }
  }

  async function downloadFile(a: Attachment) {
    const res = await apiClient.get(`/chat/attachments/${a.id}`, { responseType: "blob" });
    const url = URL.createObjectURL(res.data as Blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = a.filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function openModal(kind: "channel" | "direct" | "members") {
    setNewName("");
    setNewPrivate(false);
    setPicked(new Set());
    setPersonFilter("");
    setError(null);
    setModal(kind);
  }

  function togglePicked(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function createChannel(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await apiClient.post<{ id: string }>("/chat/channels", { name: newName, isPrivate: newPrivate, memberUserIds: newPrivate ? [...picked] : undefined });
      setModal(null);
      await loadChannels();
      openChannel(res.data.id);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Couldn't create the channel");
    }
  }

  async function startDirect(userId: string) {
    try {
      const res = await apiClient.post<{ id: string }>("/chat/direct", { userId });
      setModal(null);
      await loadChannels();
      openChannel(res.data.id);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Couldn't start the chat");
    }
  }

  async function addMembers() {
    if (!activeId || picked.size === 0) return;
    try {
      await apiClient.post(`/chat/channels/${activeId}/members`, { userIds: [...picked] });
      const det = await apiClient.get<Details>(`/chat/channels/${activeId}`);
      setDetails(det.data);
      setPicked(new Set());
      loadChannels();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Couldn't add them");
    }
  }

  async function deleteChannel() {
    if (!activeId || !window.confirm("Delete this channel and all of its messages for everyone? This can't be undone.")) return;
    try {
      await apiClient.delete(`/chat/channels/${activeId}`);
      setModal(null);
      setActiveId(null);
      setDetails(null);
      setMessages([]);
      setShowList(true);
      loadChannels();
      announceUnread();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Couldn't delete the channel");
    }
  }

  const rooms = channels.filter((c) => c.kind === "CHANNEL");
  const directs = channels.filter((c) => c.kind === "DIRECT");
  const active = channels.find((c) => c.id === activeId);
  const filteredPeople = people.filter((p) => p.id !== me && `${p.name} ${p.email}`.toLowerCase().includes(personFilter.toLowerCase()));
  const notInChannel = people.filter((p) => !(details?.members ?? []).some((m) => m.id === p.id));

  const renderRow = (c: Channel) => (
    <button key={c.id} type="button" className={`chat-row ${c.id === activeId ? "active" : ""}`} onClick={() => openChannel(c.id)}>
      <span className="chat-row-icon">{c.kind === "DIRECT" ? initials(c.name) : c.isPrivate ? <Lock /> : "#"}</span>
      <span className="chat-row-text">
        <span className="chat-row-name">{c.name}</span>
        {c.lastMessage && (
          <span className="chat-row-preview">
            {c.lastMessage.senderName.split(" ")[0]}: {c.lastMessage.preview}
          </span>
        )}
      </span>
      {c.unread > 0 && <span className="chat-badge">{c.unread > 99 ? "99+" : c.unread}</span>}
    </button>
  );

  let lastDay = "";

  return (
    <div className={`chat-shell ${showList ? "show-list" : ""}`}>
      <aside className="chat-sidebar">
        <div className="chat-side-head">
          <strong>Team Chat</strong>
        </div>
        <div className="chat-side-scroll">
          <div className="chat-section-title">
            <span>Channels</span>
            <button type="button" className="chat-plus" title="New channel" onClick={() => openModal("channel")}>
              +
            </button>
          </div>
          {rooms.map(renderRow)}
          <div className="chat-section-title">
            <span>Direct messages</span>
            <button type="button" className="chat-plus" title="New message" onClick={() => openModal("direct")}>
              +
            </button>
          </div>
          {directs.map(renderRow)}
          {directs.length === 0 && <p className="chat-empty-note">Start a one-to-one chat with the + above.</p>}
        </div>
      </aside>

      <section className="chat-conversation">
        {!activeId ? (
          <div className="chat-placeholder">Pick a channel or a person to start chatting.</div>
        ) : (
          <>
            <header className="chat-head">
              <button type="button" className="secondary chat-back" onClick={() => setShowList(true)}>
                ←
              </button>
              <div className="chat-head-title">
                <strong>{active?.kind === "DIRECT" ? active.name : <>{active?.isPrivate ? <Lock /> : "#"} {details?.name ?? active?.name ?? ""}</>}</strong>
                {active?.kind === "CHANNEL" && <span className="chat-head-sub">{details?.members.length ?? active.memberCount} members</span>}
              </div>
              {active?.kind === "CHANNEL" && (
                <button type="button" className="secondary" onClick={() => openModal("members")}>
                  Members
                </button>
              )}
            </header>

            <div className="chat-messages" ref={scrollRef} onScroll={onScroll}>
              {hasMore && (
                <button type="button" className="secondary chat-earlier" onClick={loadEarlier}>
                  Load earlier messages
                </button>
              )}
              {messages.length === 0 && <p className="chat-empty-note">No messages yet. Say hello.</p>}
              {messages.map((m) => {
                const day = dayLabel(m.createdAt);
                const showDay = day !== lastDay;
                lastDay = day;
                const mine = m.senderUserId === me;
                return (
                  <div key={m.id}>
                    {showDay && <div className="chat-day">{day}</div>}
                    <div className={`chat-msg ${mine ? "mine" : ""}`}>
                      {!mine && <div className="chat-avatar">{initials(m.senderName)}</div>}
                      <div className="chat-bubble">
                        <div className="chat-meta">
                          {!mine && <strong>{m.senderName}</strong>}
                          <span>{timeLabel(m.createdAt)}</span>
                          {mine && !m.deleted && (
                            <button type="button" className="chat-delete" title="Delete" onClick={() => removeMessage(m.id)}>
                              ×
                            </button>
                          )}
                        </div>
                        {m.deleted ? (
                          <em className="chat-deleted">This message was deleted</em>
                        ) : (
                          <>
                            {m.body && <div className="chat-text">{m.body}</div>}
                            {m.attachment &&
                              (m.attachment.mimeType.startsWith("image/") ? (
                                <ChatImage attachment={m.attachment} onOpen={() => setViewer(m.attachment)} />
                              ) : (
                                <button type="button" className="chat-file" onClick={() => (m.attachment!.mimeType === "application/pdf" ? setViewer(m.attachment) : downloadFile(m.attachment!))}>
                                  <Clip /> {m.attachment.filename} <span>{sizeLabel(m.attachment.size)}</span>
                                </button>
                              ))}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {error && <div className="error-banner" style={{ margin: "0 12px" }}>{error}</div>}
            <form className="chat-composer" onSubmit={send}>
              {file && (
                <div className="chat-pending-file">
                  <Clip /> {file.name} <span>{sizeLabel(file.size)}</span>
                  <button type="button" className="chat-delete" onClick={() => setFile(null)}>
                    ×
                  </button>
                </div>
              )}
              <div className="chat-composer-row">
                <input ref={fileInput} type="file" style={{ display: "none" }} onChange={(e) => { pickFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
                <button type="button" className="secondary" title="Attach a file (max 5 MB)" onClick={() => fileInput.current?.click()}>
                  <Clip />
                </button>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKey}
                  placeholder="Write a message. Enter to send, Shift+Enter for a new line"
                  rows={1}
                  maxLength={4000}
                />
                <button type="submit" disabled={sending || (!draft.trim() && !file)}>
                  {sending ? "…" : "Send"}
                </button>
              </div>
            </form>
          </>
        )}
      </section>

      {modal && (
        <div className="chat-modal-backdrop" onClick={() => setModal(null)}>
          <div className="chat-modal" onClick={(e) => e.stopPropagation()}>
            {modal === "channel" && (
              <form onSubmit={createChannel}>
                <h3>New channel</h3>
                <input placeholder="Channel name, e.g. sales-team" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={40} required autoFocus style={{ width: "100%" }} />
                <label style={{ display: "block", margin: "10px 0" }}>
                  <input type="checkbox" checked={newPrivate} onChange={(e) => setNewPrivate(e.target.checked)} /> Private: only the people you pick can see it
                </label>
                {newPrivate && (
                  <div className="chat-pick-list">
                    {people.filter((p) => p.id !== me).map((p) => (
                      <label key={p.id}>
                        <input type="checkbox" checked={picked.has(p.id)} onChange={() => togglePicked(p.id)} /> {p.name} <span>{p.email}</span>
                      </label>
                    ))}
                  </div>
                )}
                {!newPrivate && <p className="chat-empty-note">Everyone in the company can see and join a public channel.</p>}
                {error && <div className="error-banner">{error}</div>}
                <div className="form-row" style={{ justifyContent: "flex-end" }}>
                  <button type="button" className="secondary" onClick={() => setModal(null)}>
                    Cancel
                  </button>
                  <button type="submit">Create channel</button>
                </div>
              </form>
            )}

            {modal === "direct" && (
              <div>
                <h3>New message</h3>
                <input placeholder="Search people" value={personFilter} onChange={(e) => setPersonFilter(e.target.value)} autoFocus style={{ width: "100%" }} />
                <div className="chat-pick-list">
                  {filteredPeople.map((p) => (
                    <button key={p.id} type="button" className="chat-person" onClick={() => startDirect(p.id)}>
                      <span className="chat-row-icon">{initials(p.name)}</span> {p.name} <span>{p.email}</span>
                    </button>
                  ))}
                  {filteredPeople.length === 0 && <p className="chat-empty-note">No one else is in this company yet. Invite people from Users.</p>}
                </div>
                {error && <div className="error-banner">{error}</div>}
              </div>
            )}

            {modal === "members" && details && (
              <div>
                <h3>
                  {details.isPrivate ? <Lock /> : "#"} {details.name}: members
                </h3>
                <div className="chat-pick-list">
                  {details.members.map((m) => (
                    <div key={m.id} className="chat-person-static">
                      <span className="chat-row-icon">{initials(m.name)}</span> {m.name}
                    </div>
                  ))}
                </div>
                {details.isPrivate && notInChannel.length > 0 && (
                  <>
                    <h4 style={{ marginBottom: 4 }}>Add people</h4>
                    <div className="chat-pick-list">
                      {notInChannel.map((p) => (
                        <label key={p.id}>
                          <input type="checkbox" checked={picked.has(p.id)} onChange={() => togglePicked(p.id)} /> {p.name} <span>{p.email}</span>
                        </label>
                      ))}
                    </div>
                    <button type="button" disabled={picked.size === 0} onClick={addMembers}>
                      Add selected
                    </button>
                  </>
                )}
                {!details.isPrivate && <p className="chat-empty-note">This is a public channel: everyone in the company is in it.</p>}
                {error && <div className="error-banner">{error}</div>}
                <div className="form-row" style={{ justifyContent: "space-between", marginTop: 12 }}>
                  {details.createdByMe && details.kind === "CHANNEL" ? (
                    <button type="button" className="danger" onClick={deleteChannel}>
                      Delete channel
                    </button>
                  ) : (
                    <span />
                  )}
                  <button type="button" className="secondary" onClick={() => setModal(null)}>
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {viewer && (
        <AttachmentViewer
          filename={viewer.filename}
          mimeType={viewer.mimeType}
          fetchBlob={() => apiClient.get(`/chat/attachments/${viewer.id}`, { responseType: "blob" }).then((res) => res.data as Blob)}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}
