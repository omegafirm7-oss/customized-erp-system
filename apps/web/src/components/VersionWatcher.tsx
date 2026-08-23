import { useEffect, useState } from "react";

/**
 * A logged-in tab keeps running the JS bundle it loaded at sign-in — a
 * client-side route change never re-fetches index.html, so a deploy that
 * happens while someone is signed in leaves their tab on the old code
 * until they hit refresh. That's why a brand-new feature can "not show up"
 * right after login but appear the moment the page is reloaded — the tab
 * simply hadn't picked up the new bundle yet. This periodically re-fetches
 * index.html and compares it against the entry script this tab actually
 * booted from; once they diverge, a deploy has happened underneath the
 * user and we prompt a refresh instead of leaving them on stale code.
 */
function currentEntryScriptSrc(): string | null {
  for (const s of document.querySelectorAll('script[type="module"][src]')) {
    const src = s.getAttribute("src");
    if (src?.includes("/assets/")) return src;
  }
  return null;
}

export function VersionWatcher() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    const knownSrc = currentEntryScriptSrc();
    if (!knownSrc) return; // dev server serves an unhashed entry — nothing to compare

    async function check() {
      try {
        const res = await fetch("/", { cache: "no-store" });
        const html = await res.text();
        if (!html.includes(knownSrc!)) setUpdateAvailable(true);
      } catch {
        // transient network hiccup — try again next interval
      }
    }

    const interval = setInterval(check, 5 * 60 * 1000);
    function onVisible() {
      if (document.visibilityState === "visible") check();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!updateAvailable) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 20,
        right: 20,
        zIndex: 1000,
        background: "#101828",
        color: "#fff",
        padding: "12px 16px",
        borderRadius: 10,
        boxShadow: "0 4px 16px rgba(16,24,40,0.35)",
        display: "flex",
        alignItems: "center",
        gap: 14,
        fontSize: 13.5,
        maxWidth: 340,
      }}
    >
      <span>A new version of Universa Centrix is available.</span>
      <button
        onClick={() => window.location.reload()}
        style={{
          background: "#2a78d6",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          padding: "7px 14px",
          cursor: "pointer",
          fontWeight: 600,
          fontSize: 13,
          whiteSpace: "nowrap",
        }}
      >
        Refresh
      </button>
    </div>
  );
}
