import { useEffect } from "react";

/**
 * Landed here via a top-level browser redirect from the backend's Google
 * OAuth callback, which already set the httpOnly refresh cookie. A full
 * reload (not a react-router navigate) re-mounts AuthProvider, whose normal
 * bootstrap effect picks the session up from that cookie exactly the same
 * way it does on any other page load — no separate code path needed here.
 */
export function AuthCallbackPage() {
  useEffect(() => {
    window.location.replace("/companies");
  }, []);

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
      <p style={{ color: "#667085" }}>Signing you in…</p>
    </div>
  );
}
