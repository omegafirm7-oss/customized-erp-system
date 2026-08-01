import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AuthVisual } from "../components/AuthVisual";
import { GoogleSignInButton } from "../components/GoogleSignInButton";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate("/companies");
    } catch {
      setError("Invalid email or password");
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
            Welcome
            <br />
            Back,
          </h1>
        </div>
        <div className="auth-visual-bottom">
          <div className="auth-brand">
            <span className="auth-brand-mark">UC</span>
            <span className="auth-brand-name">Universa Centrix</span>
          </div>
          <p>Run your business — finance, projects, HR, and more — from one place.</p>
        </div>
      </div>
      <div className="auth-form-panel">
        <form onSubmit={handleSubmit} className="auth-form-box">
          <h2>Login</h2>
          <p className="auth-form-subtitle">Sign in to continue to Universa Centrix.</p>
          {error && <div className="error-banner">{error}</div>}
          <GoogleSignInButton />
          <div className="auth-divider">Or sign in with email</div>
          <div className="auth-field">
            <label>Email</label>
            <input type="email" placeholder="mail@website.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="auth-field">
            <label>Password</label>
            <input
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" disabled={submitting} style={{ width: "100%" }}>
            {submitting ? "Signing in…" : "Login"}
          </button>
          <p style={{ fontSize: 13, marginTop: 16, textAlign: "center" }}>
            Not registered yet? <Link to="/register">Create an Account</Link>
          </p>
          <p style={{ fontSize: 12, marginTop: 12, color: "#98a2b3", textAlign: "center" }}>
            Forgot your password? Ask a company Administrator to reset it for you — self-service email reset isn't
            available yet.
          </p>
        </form>
      </div>
    </div>
  );
}
