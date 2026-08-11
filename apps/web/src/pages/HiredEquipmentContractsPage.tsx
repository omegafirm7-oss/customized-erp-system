import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../api/client";

interface Contract {
  id: string;
  code: string;
  name: string;
  status: string;
  startDate: string;
  project: { code: string; name: string };
  businessPartner: { code: string; name: string };
  _count: { assignments: number; timesheets: number };
}

interface Partner {
  id: string;
  code: string;
  name: string;
  partnerType: string;
}

interface ProjectRef {
  id: string;
  code: string;
  name: string;
  status: string;
}

export function HiredEquipmentContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    code: "",
    name: "",
    businessPartnerId: "",
    projectId: "",
    startDate: new Date().toISOString().slice(0, 10),
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [contractsRes, partnersRes, projectsRes] = await Promise.all([
        apiClient.get<Contract[]>("/hired-equipment/contracts"),
        apiClient.get<Partner[]>("/partners"),
        apiClient.get<ProjectRef[]>("/projects"),
      ]);
      setContracts(contractsRes.data);
      setPartners(partnersRes.data.filter((p) => ["VENDOR", "BOTH"].includes(p.partnerType)));
      setProjects(projectsRes.data.filter((p) => p.status !== "CLOSED"));
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
      await apiClient.post("/hired-equipment/contracts", form);
      setForm({ ...form, code: "", name: "" });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create contract");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>Hired Equipment</h2>
        <p style={{ color: "#667085", fontSize: 13 }}>
          Equipment rented from a vendor for a project — log daily usage on a timesheet and generate the vendor's
          purchase invoice from it. Cost flows straight into that project's Project Intelligence Machinery total.
        </p>
        {loading ? (
          <p>Loading…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Vendor</th>
                <th>Project</th>
                <th>Start</th>
                <th>Units</th>
                <th>Timesheets</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/hired-equipment/contracts/${c.id}`}>{c.code}</Link>
                  </td>
                  <td>{c.name}</td>
                  <td>{c.businessPartner.name}</td>
                  <td>{c.project.code}</td>
                  <td>{new Date(c.startDate).toLocaleDateString()}</td>
                  <td>{c._count.assignments}</td>
                  <td>{c._count.timesheets}</td>
                  <td>
                    <span className={`badge ${c.status === "ACTIVE" ? "posted" : "reversed"}`}>{c.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>New contract</h3>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={handleCreate}>
          <div className="form-row">
            <input placeholder="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
            <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required style={{ flex: 1 }} />
            <select value={form.businessPartnerId} onChange={(e) => setForm({ ...form, businessPartnerId: e.target.value })} required>
              <option value="" disabled>
                Select vendor…
              </option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
            <select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} required>
              <option value="" disabled>
                Select project…
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
            <div>
              <label>Start </label>
              <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
            </div>
            <button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
