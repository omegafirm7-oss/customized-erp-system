import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiClient } from "../api/client";
import { useAuth } from "../auth/AuthContext";

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
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
      <form onSubmit={handleSubmit} className="card" style={{ width: 340 }}>
        <h2>Create account</h2>
        {error && <div className="error-banner">{error}</div>}
        <div className="form-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <label>Full name</label>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </div>
        <div className="form-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="form-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <label>Password (min 10 characters)</label>
          <input type="password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <button type="submit" disabled={submitting} style={{ width: "100%", marginTop: 8 }}>
          {submitting ? "Creating…" : "Create account"}
        </button>
        <p style={{ fontSize: 13, marginTop: 12 }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
