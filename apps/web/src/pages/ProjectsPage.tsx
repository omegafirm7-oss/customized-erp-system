import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../api/client";

interface Project {
  id: string;
  code: string;
  name: string;
  status: string;
  recognitionMethod: string;
  contractValue: string;
  estimatedTotalCost: string;
  costCenter: { code: string };
  businessPartner: { code: string; name: string } | null;
  _count: { tasks: number; revenueRecognitionRuns: number };
}

interface Partner {
  id: string;
  code: string;
  name: string;
  partnerType: string;
}

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    code: "",
    name: "",
    businessPartnerId: "",
    recognitionMethod: "POINT_IN_TIME",
    contractValue: "",
    estimatedTotalCost: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [projectsRes, partnersRes] = await Promise.all([
        apiClient.get<Project[]>("/projects"),
        apiClient.get<Partner[]>("/partners"),
      ]);
      setProjects(projectsRes.data);
      setPartners(partnersRes.data.filter((p) => ["CUSTOMER", "BOTH"].includes(p.partnerType)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.post("/projects", {
        code: form.code,
        name: form.name,
        businessPartnerId: form.businessPartnerId || undefined,
        recognitionMethod: form.recognitionMethod,
        contractValue: form.contractValue || undefined,
        estimatedTotalCost: form.estimatedTotalCost || undefined,
      });
      setForm({ code: "", name: "", businessPartnerId: "", recognitionMethod: "POINT_IN_TIME", contractValue: "", estimatedTotalCost: "" });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create project");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>Projects</h2>
        {loading ? (
          <p>Loading…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Customer</th>
                <th>Method</th>
                <th>Contract</th>
                <th>Est. Cost</th>
                <th>Status</th>
                <th>Tasks</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/projects/${p.id}`}>{p.code}</Link>
                  </td>
                  <td>{p.name}</td>
                  <td>{p.businessPartner?.name ?? "—"}</td>
                  <td>{p.recognitionMethod === "OVER_TIME" ? "Over time (POC)" : "Point in time"}</td>
                  <td>{Number(p.contractValue).toFixed(2)}</td>
                  <td>{Number(p.estimatedTotalCost).toFixed(2)}</td>
                  <td>
                    <span className={`badge ${p.status === "ACTIVE" ? "posted" : p.status === "CLOSED" ? "reversed" : "draft"}`}>
                      {p.status}
                    </span>
                  </td>
                  <td>{p._count.tasks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>New project</h3>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={handleCreate}>
          <div className="form-row">
            <input placeholder="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
            <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required style={{ flex: 1 }} />
            <select value={form.businessPartnerId} onChange={(e) => setForm({ ...form, businessPartnerId: e.target.value })}>
              <option value="">No customer</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <select value={form.recognitionMethod} onChange={(e) => setForm({ ...form, recognitionMethod: e.target.value })}>
              <option value="POINT_IN_TIME">Point in time (normal revenue)</option>
              <option value="OVER_TIME">Over time (POC / IFRS 15)</option>
            </select>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Contract value"
              value={form.contractValue}
              onChange={(e) => setForm({ ...form, contractValue: e.target.value })}
            />
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Estimated total cost"
              value={form.estimatedTotalCost}
              onChange={(e) => setForm({ ...form, estimatedTotalCost: e.target.value })}
            />
            <button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
