import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiClient } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { AuthVisual } from "../components/AuthVisual";
import { GoogleSignInButton } from "../components/GoogleSignInButton";

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
    <div className="auth-shell">
      <div className="auth-visual">
        <AuthVisual />
        <div className="auth-visual-top">
          <h1>
            Get
            <br />
            Started,
          </h1>
        </div>
        <div className="auth-visual-bottom">
          <div className="auth-brand">
            <span className="auth-brand-mark">UC</span>
            <span className="auth-brand-name">Universa Centrix</span>
          </div>
          <p>Enter your details and start managing your business today.</p>
        </div>
      </div>
      <div className="auth-form-panel">
        <form onSubmit={handleSubmit} className="auth-form-box">
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
      </div>
    </div>
  );
}
