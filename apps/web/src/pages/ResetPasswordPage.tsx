import { FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiClient } from "../api/client";
import { AuthVisual } from "../components/AuthVisual";

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    setSubmitting(true);
    try {
      await apiClient.post("/auth/reset-password", { token, newPassword });
      setDone(true);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "This reset link is invalid or has expired — request a new one");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <AuthVisual />
      <div className="auth-page-overlay" />
      <div className="auth-simple-card">
        <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.3, color: "#9aa5bb", marginBottom: 18, textAlign: "center" }}>
          UNIVERSA CENTRIX
        </p>
        {done ? (
          <>
            <div className="auth-check-icon">
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.4">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <h2 style={{ textAlign: "center" }}>Password updated</h2>
            <p className="auth-form-subtitle" style={{ textAlign: "center" }}>
              Your password has been changed. All other sessions have been signed out for security.
            </p>
            <Link to="/login">
              <button type="button" style={{ width: "100%" }}>
                Go to sign in
              </button>
            </Link>
          </>
        ) : !token ? (
          <>
            <h2>Invalid reset link</h2>
            <p className="auth-form-subtitle">This link is missing its reset code. Request a new one below.</p>
            <Link to="/forgot-password">
              <button type="button" style={{ width: "100%" }}>
                Request a new link
              </button>
            </Link>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <h2>Choose a new password</h2>
            <p className="auth-form-subtitle">Set and confirm your new password below.</p>
            {error && <div className="error-banner">{error}</div>}
            <div className="auth-field">
              <label>New password</label>
              <input
                type="password"
                placeholder="Min. 10 characters"
                minLength={10}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </div>
            <div className="auth-field">
              <label>Confirm new password</label>
              <input
                type="password"
                placeholder="Re-enter password"
                minLength={10}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            <button type="submit" disabled={submitting} style={{ width: "100%" }}>
              {submitting ? "Saving…" : "Save new password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
