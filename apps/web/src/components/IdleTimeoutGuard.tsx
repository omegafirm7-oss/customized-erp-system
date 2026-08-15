import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { apiClient } from "../api/client";

// Mirrors IDLE_TIMEOUT_MS/IDLE_WARNING_MS in @erp/shared-constants (kept as
// the source-of-truth comment on the backend side, in auth.service.ts) —
// not imported at runtime because @erp/shared-constants ships plain CJS and
// Vite's dev-server @fs passthrough can't resolve named exports from it
// (see feature_module_entitlement_phase1 memory: MODULE_KEYS hit the same
// issue). Keep these two literals in sync with the backend by hand.
const IDLE_TIMEOUT_MS = 3 * 60 * 1000;
const IDLE_WARNING_MS = 2 * 60 * 1000;
const IDLE_TOTAL_MS = IDLE_TIMEOUT_MS + IDLE_WARNING_MS;
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "touchstart", "scroll"] as const;
// How often a real activity event is allowed to re-hit the backend — no
// need to heartbeat on every single mousemove.
const HEARTBEAT_MIN_INTERVAL_MS = 20 * 1000;
// How often to re-derive idle state from wall-clock time. A plain
// setTimeout(fn, 3min) scheduled once drifts badly if the tab gets
// backgrounded (Chrome throttles background-tab timers), which is what
// made the warning appear late/inconsistently after switching tabs — a
// short interval that recomputes "now - lastActivity" from scratch each
// tick self-corrects the moment the tab is foregrounded again.
const TICK_MS = 1000;

/**
 * Auto-logs the user out after 3 minutes of no mouse/keyboard/scroll
 * activity, with a 2-minute countdown warning (5 minutes total) — either
 * dismiss it (the "Stay signed in" button) or it logs out automatically
 * when it hits zero. Mirrored server-side: POST /auth/heartbeat records the
 * same activity so a stale session is revoked even if this tab's timer
 * never gets to fire (backgrounded/suspended tab, or a fresh tab opened
 * after the old one had already gone idle — see AuthService.touchActivity).
 * Only mounted inside authenticated routes (Layout), so it's inert on the
 * login/register pages.
 */
export function IdleTimeoutGuard() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const lastActivityRef = useRef(Date.now());
  const lastHeartbeatRef = useRef(0);
  const loggedOutRef = useRef(false);
  const warningActiveRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const doLogout = useCallback(async () => {
    if (loggedOutRef.current) return;
    loggedOutRef.current = true;
    if (intervalRef.current) clearInterval(intervalRef.current);
    setSecondsLeft(null);
    try {
      await logout();
    } finally {
      navigate("/login", { replace: true });
    }
  }, [logout, navigate]);

  const heartbeat = useCallback(() => {
    const now = Date.now();
    if (now - lastHeartbeatRef.current < HEARTBEAT_MIN_INTERVAL_MS) return;
    lastHeartbeatRef.current = now;
    apiClient.post("/auth/heartbeat").catch(() => {
      // A stale-session rejection here just means the next tick's own
      // wall-clock check will also conclude it's time to log out — no need
      // to special-case the heartbeat failure itself.
    });
  }, []);

  const markActivity = useCallback(() => {
    // While the warning is up, only an explicit "Stay signed in" click
    // (staySignedIn below) should cancel it — otherwise stray mouse
    // movement while reading the warning would silently swallow it.
    if (warningActiveRef.current) return;
    lastActivityRef.current = Date.now();
    heartbeat();
  }, [heartbeat]);

  const staySignedIn = useCallback(() => {
    warningActiveRef.current = false;
    lastActivityRef.current = Date.now();
    lastHeartbeatRef.current = 0; // force an immediate heartbeat
    setSecondsLeft(null);
    heartbeat();
  }, [heartbeat]);

  useEffect(() => {
    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, markActivity, { passive: true });
    }
    heartbeat();

    intervalRef.current = setInterval(() => {
      if (loggedOutRef.current) return;
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed >= IDLE_TOTAL_MS) {
        void doLogout();
        return;
      }
      if (elapsed >= IDLE_TIMEOUT_MS) {
        warningActiveRef.current = true;
        setSecondsLeft(Math.ceil((IDLE_TOTAL_MS - elapsed) / 1000));
      }
    }, TICK_MS);

    return () => {
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, markActivity);
      }
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (secondsLeft === null) return null;

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
      }}
    >
      <div style={{ background: "#fff", borderRadius: 8, padding: 28, maxWidth: 380, textAlign: "center" }}>
        <h3 style={{ marginTop: 0 }}>Still there?</h3>
        <p style={{ color: "#667085" }}>
          You've been inactive for a while. For your security, you'll be signed out in
        </p>
        <div style={{ fontSize: 32, fontWeight: 700, color: "#101828", margin: "8px 0 20px" }}>
          {minutes}:{String(seconds).padStart(2, "0")}
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button onClick={staySignedIn}>Stay signed in</button>
          <button className="secondary" onClick={() => void doLogout()}>
            Log out now
          </button>
        </div>
      </div>
    </div>
  );
}
