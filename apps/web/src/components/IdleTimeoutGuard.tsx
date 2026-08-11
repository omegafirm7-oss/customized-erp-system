import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const IDLE_LIMIT_MS = 5 * 60 * 1000;
const WARNING_DURATION_MS = 2 * 60 * 1000;
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "touchstart", "scroll"] as const;

/**
 * Auto-logs the user out after 5 minutes of no mouse/keyboard/scroll
 * activity, with a 2-minute countdown warning first — either dismiss it
 * (any click, or the "Stay signed in" button) or it logs out automatically
 * when it hits zero. Only mounted inside authenticated routes (Layout), so
 * it's inert on the login/register pages.
 */
export function IdleTimeoutGuard() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const warningRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
  }, []);

  const doLogout = useCallback(async () => {
    clearTimers();
    warningRef.current = false;
    setSecondsLeft(null);
    try {
      await logout();
    } finally {
      navigate("/login", { replace: true });
    }
  }, [clearTimers, logout, navigate]);

  const startCountdown = useCallback(() => {
    warningRef.current = true;
    let remaining = Math.floor(WARNING_DURATION_MS / 1000);
    setSecondsLeft(remaining);
    countdownIntervalRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearTimers();
        void doLogout();
        return;
      }
      setSecondsLeft(remaining);
    }, 1000);
  }, [clearTimers, doLogout]);

  const resetIdleTimer = useCallback(() => {
    // While the warning is up, only an explicit "Stay signed in" click (or
    // the dismiss handler below) should cancel it — otherwise stray mouse
    // movement while reading the warning would silently swallow it.
    if (warningRef.current) return;
    clearTimers();
    idleTimerRef.current = setTimeout(startCountdown, IDLE_LIMIT_MS);
  }, [clearTimers, startCountdown]);

  const staySignedIn = useCallback(() => {
    clearTimers();
    warningRef.current = false;
    setSecondsLeft(null);
    idleTimerRef.current = setTimeout(startCountdown, IDLE_LIMIT_MS);
  }, [clearTimers, startCountdown]);

  useEffect(() => {
    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, resetIdleTimer, { passive: true });
    }
    resetIdleTimer();
    return () => {
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, resetIdleTimer);
      }
      clearTimers();
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
