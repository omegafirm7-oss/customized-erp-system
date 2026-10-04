import { ReactNode, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";

// How long the content stays obscured after a screenshot-style key combo,
// long enough for the OS capture to finish while the page is blanked.
const OBSCURE_HOLD_MS = 2500;

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function watermarkBackground(label: string): string {
  const safe = label.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="260">` +
    `<text x="50%" y="50%" text-anchor="middle" transform="rotate(-24 210 130)" ` +
    `font-family="Arial, sans-serif" font-size="15" fill="rgba(16,24,40,0.10)">${safe}</text></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

/**
 * Deterrents against bulk-copying or screenshotting sensitive screens (the
 * Project dashboard family and Purchase Invoices). A browser cannot truly
 * prevent a screenshot — OS-level capture and a phone camera are outside
 * its reach — so this layers what a web page *can* do: disables selecting,
 * copying and printing the page, blanks the content whenever the window
 * loses focus or a screenshot-style key combo is pressed, and stamps a
 * faint watermark with the viewer's email and the time over everything so
 * any leaked image traces back to who captured it.
 *
 * Typing in form fields still works normally, including copy/paste inside
 * a single field.
 */
export function ProtectedContent({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [obscured, setObscured] = useState(false);
  const [stamp, setStamp] = useState(() => new Date());
  const holdTimer = useRef<number | null>(null);
  const watermarkRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = window.setInterval(() => setStamp(new Date()), 30 * 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    function obscureFor(ms: number) {
      setObscured(true);
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
      holdTimer.current = window.setTimeout(() => {
        holdTimer.current = null;
        if (document.hasFocus() && document.visibilityState === "visible") setObscured(false);
      }, ms);
    }

    function onBlockedEvent(e: Event) {
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
    }

    function onKeyDown(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;

      if (e.key === "PrintScreen") {
        obscureFor(OBSCURE_HOLD_MS);
        navigator.clipboard?.writeText("").catch(() => undefined);
        return;
      }
      // Win+Shift+S / Cmd+Shift+3/4/5 snipping shortcuts: the page can only
      // see the modifiers, so blank on Meta+Shift as soon as it's seen.
      if (e.metaKey && e.shiftKey) {
        obscureFor(OBSCURE_HOLD_MS);
        return;
      }
      if (e.key === "F12" || (mod && e.shiftKey && ["i", "j", "c"].includes(key))) {
        e.preventDefault();
        return;
      }
      if (mod && ["s", "p", "u"].includes(key)) {
        e.preventDefault();
        return;
      }
      // Select-all / copy / cut are only allowed inside an actual form field.
      if (mod && ["a", "c", "x"].includes(key) && !isEditableTarget(e.target)) {
        e.preventDefault();
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.key === "PrintScreen") {
        navigator.clipboard?.writeText("").catch(() => undefined);
        obscureFor(OBSCURE_HOLD_MS);
      }
    }

    function onWindowBlur() {
      // Focus moving into an iframe (e.g. the PDF viewer) also fires blur,
      // but document.hasFocus() stays true there — only blank when the whole
      // document really lost focus (another window/app took it).
      window.setTimeout(() => {
        if (!document.hasFocus()) setObscured(true);
      }, 0);
    }

    function onWindowFocus() {
      if (holdTimer.current === null && document.visibilityState === "visible") setObscured(false);
    }

    function onVisibility() {
      if (document.visibilityState === "hidden") setObscured(true);
      else if (holdTimer.current === null && document.hasFocus()) setObscured(false);
    }

    // Starting obscured when the page opens without focus (e.g. opened in a
    // background tab) keeps data off-screen until the user actually looks.
    if (!document.hasFocus()) setObscured(true);

    document.addEventListener("copy", onBlockedEvent, true);
    document.addEventListener("cut", onBlockedEvent, true);
    document.addEventListener("contextmenu", onBlockedEvent, true);
    document.addEventListener("dragstart", onBlockedEvent, true);
    document.addEventListener("selectstart", onBlockedEvent, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("focus", onWindowFocus);

    return () => {
      document.removeEventListener("copy", onBlockedEvent, true);
      document.removeEventListener("cut", onBlockedEvent, true);
      document.removeEventListener("contextmenu", onBlockedEvent, true);
      document.removeEventListener("dragstart", onBlockedEvent, true);
      document.removeEventListener("selectstart", onBlockedEvent, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("keyup", onKeyUp, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("focus", onWindowFocus);
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    };
  }, []);

  // If the watermark node is removed (e.g. via dev tools), put it straight back.
  useEffect(() => {
    const node = watermarkRef.current;
    const parent = node?.parentElement;
    if (!node || !parent) return;
    const observer = new MutationObserver(() => {
      if (!parent.contains(node)) parent.appendChild(node);
    });
    observer.observe(parent, { childList: true });
    return () => observer.disconnect();
  }, []);

  const label = `${user?.email ?? "confidential"} • ${stamp.toLocaleString()}`;

  return (
    <>
      <div className="protected-content" data-obscured={obscured ? "true" : "false"}>
        {children}
      </div>
      <div className="protected-print-notice">Printing is disabled for this page.</div>
      <div ref={watermarkRef} className="protected-watermark" style={{ backgroundImage: watermarkBackground(label) }} />
      {obscured && (
        <div
          className="protected-cover"
          onClick={() => {
            if (holdTimer.current === null && document.hasFocus()) setObscured(false);
          }}
        >
          <span>Content hidden — click here to resume</span>
        </div>
      )}
    </>
  );
}
