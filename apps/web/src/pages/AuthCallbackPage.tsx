import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

/**
 * Landed here via a top-level browser redirect from the backend's Google
 * OAuth callback. The backend hands the freshly-issued access token in the
 * URL fragment (#at=...) alongside setting the httpOnly refresh cookie —
 * applying it directly here and moving on with a client-side navigate avoids
 * ever calling /auth/refresh from this page, which used to race the next
 * page's own bootstrap refresh over the same just-rotated cookie and could
 * revoke the session it had just created (see AuthContext.tsx).
 */
export function AuthCallbackPage() {
  const { restoreFromToken } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    // window.location.hash includes the leading "#" (e.g. "#at=..."), so it
    // must be stripped before parsing as query-string-shaped params.
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get("at");
    if (token) {
      restoreFromToken(token);
      navigate("/companies", { replace: true });
    } else {
      // No token in the URL — not the expected path, but fall back to the
      // cookie-based bootstrap a normal page load would do.
      window.location.replace("/companies");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
      <p style={{ color: "#667085" }}>Signing you in…</p>
    </div>
  );
}
