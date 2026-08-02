import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../api/client";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      // Backend always responds the same way whether or not the email is
      // registered — see AuthService.requestPasswordReset — so there's
      // nothing to branch on here besides the request finishing.
      await apiClient.post("/auth/forgot-password", { email });
    } finally {
      setSubmitting(false);
      setSent(true);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-page-header">
        <h1>Universa Centrix</h1>
      </div>
      <div className="auth-simple-card">
        {sent ? (
          <>
            <div className="auth-check-icon">
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.4">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <h2 style={{ textAlign: "center" }}>Check your email</h2>
            <p className="auth-form-subtitle" style={{ textAlign: "center" }}>
              If an account exists for <strong>{email}</strong>, a reset link has been sent. It expires in 30
              minutes.
            </p>
            <p style={{ fontSize: 13, textAlign: "center" }}>
              ← <Link to="/login">Back to sign in</Link>
            </p>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <h2>Reset your password</h2>
            <p className="auth-form-subtitle">
              Enter the email you registered with — we&apos;ll send a link to set a new password.
            </p>
            <div className="auth-field">
              <label>Email</label>
              <input type="email" placeholder="mail@website.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <button type="submit" disabled={submitting} style={{ width: "100%" }}>
              {submitting ? "Sending…" : "Send reset link"}
            </button>
            <p style={{ fontSize: 13, marginTop: 16, textAlign: "center" }}>
              ← <Link to="/login">Back to sign in</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
