import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiClient } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { AuthVisual } from "../components/AuthVisual";
import { GoogleSignInButton } from "../components/GoogleSignInButton";
import { AuthFeatureCircles } from "../components/AuthFeatureCircles";
import { AuthTrustBadges } from "../components/AuthTrustBadges";

export function RegisterPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.post("/auth/register", { email, password, fullName });
      await login(email, password);
      navigate("/companies");
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Registration failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <AuthVisual />
      <div className="auth-page-overlay" />
      <div className="auth-glass-panel">
        <div className="auth-glass-header">
          <h1>Universa Centrix</h1>
          <p>The complete business platform — Finance, Projects, HR, and more, built for Saudi compliance.</p>
        </div>

        <AuthFeatureCircles />

        <div className="auth-glass-divider" />

        <form onSubmit={handleSubmit} className="auth-glass-form">
          <h2>Create account</h2>
          <p className="auth-form-subtitle">Sign up to get started with Universa Centrix.</p>
          {error && <div className="error-banner">{error}</div>}
          <GoogleSignInButton />
          <div className="auth-divider">Or sign up with email</div>
          <div className="auth-field">
            <label>Full name</label>
            <input placeholder="Your name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </div>
          <div className="auth-field">
            <label>Email</label>
            <input type="email" placeholder="mail@website.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="auth-field">
            <label>Password (min 10 characters)</label>
            <input
              type="password"
              placeholder="Min. 10 characters"
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" disabled={submitting} style={{ width: "100%" }}>
            {submitting ? "Creating…" : "Create account"}
          </button>
          <p style={{ fontSize: 13, marginTop: 16, textAlign: "center" }}>
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </form>

        <div className="auth-glass-divider" />

        <AuthTrustBadges />
      </div>
    </div>
  );
}
