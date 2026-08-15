import { FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AuthVisual } from "../components/AuthVisual";
import { GoogleSignInButton } from "../components/GoogleSignInButton";
import { AuthFeatureCircles } from "../components/AuthFeatureCircles";
import { AuthTrustBadges } from "../components/AuthTrustBadges";
import { AuthPitch } from "../components/AuthPitch";
import { AuthComplianceMarks } from "../components/AuthComplianceMarks";
import { AuthContact } from "../components/AuthContact";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    searchParams.get("error") === "google_auth_failed" ? "Google sign-in was cancelled or failed — please try again." : null,
  );
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
    <div className="auth-page">
      <AuthVisual />
      <div className="auth-page-overlay" />

      <div className="auth-left-content">
        <AuthComplianceMarks />
        <div className="auth-glass-header">
          <h1>Universa Centrix</h1>
          <p className="auth-mission">Grow faster. See everything. Stay compliant.</p>
        </div>
        <AuthPitch />
        <AuthFeatureCircles />
        <AuthTrustBadges />
      </div>

      <div className="auth-right">
        <div className="auth-glass-panel">
          <form onSubmit={handleSubmit} className="auth-glass-form">
            <h2>Login</h2>
            <p className="auth-form-subtitle">Sign in to continue to Universa Centrix.</p>
            {error && <div className="error-banner">{error}</div>}
            <GoogleSignInButton />
            <div className="auth-divider">Or sign in with email</div>
            <div className="auth-field">
              <label>Email</label>
              <input type="email" placeholder="Enter your email" value={email} onChange={(e) => setEmail(e.target.value)} required />
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
            <div className="auth-field-row">
              <Link to="/forgot-password">Forgot password?</Link>
            </div>
            <button type="submit" disabled={submitting} style={{ width: "100%" }}>
              {submitting ? "Signing in…" : "Login"}
            </button>
            <p style={{ fontSize: 13, marginTop: 10, textAlign: "center" }}>
              Not registered yet? <Link to="/register">Create an Account</Link>
            </p>
          </form>
        </div>

        <AuthContact />
      </div>
    </div>
  );
}
