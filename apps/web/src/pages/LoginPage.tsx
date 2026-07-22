import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

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
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
      <form onSubmit={handleSubmit} className="card" style={{ width: 340 }}>
        <h2>Sign in</h2>
        {error && <div className="error-banner">{error}</div>}
        <div className="form-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="form-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <button type="submit" disabled={submitting} style={{ width: "100%", marginTop: 8 }}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
        <p style={{ fontSize: 13, marginTop: 12 }}>
          No account? <Link to="/register">Register</Link>
        </p>
        <p style={{ fontSize: 13, marginTop: 4, color: "#667085" }}>
          Forgot your password? Ask a company Administrator to reset it for you from Users in the sidebar — self-service
          email reset isn't available yet.
        </p>
      </form>
    </div>
  );
}
