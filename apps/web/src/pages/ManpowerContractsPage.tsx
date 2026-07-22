import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../api/client";

interface Contract {
  id: string;
  code: string;
  name: string;
  status: string;
  startDate: string;
  costCenter: { code: string };
  businessPartner: { code: string; name: string };
  _count: { assignments: number; timesheets: number };
}

interface Partner {
  id: string;
  code: string;
  name: string;
  partnerType: string;
}

export function ManpowerContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    code: "",
    name: "",
    businessPartnerId: "",
    startDate: new Date().toISOString().slice(0, 10),
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [contractsRes, partnersRes] = await Promise.all([
        apiClient.get<Contract[]>("/manpower/contracts"),
        apiClient.get<Partner[]>("/partners"),
      ]);
      setContracts(contractsRes.data);
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
      await apiClient.post("/manpower/contracts", form);
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
        <h2>Manpower Contracts</h2>
        {loading ? (
          <p>Loading…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Customer</th>
                <th>Start</th>
                <th>Crew</th>
                <th>Timesheets</th>
                <th>Cost center</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/manpower/contracts/${c.id}`}>{c.code}</Link>
                  </td>
                  <td>{c.name}</td>
                  <td>{c.businessPartner.name}</td>
                  <td>{new Date(c.startDate).toLocaleDateString()}</td>
                  <td>{c._count.assignments}</td>
                  <td>{c._count.timesheets}</td>
                  <td>{c.costCenter.code}</td>
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
                Select customer…
              </option>
              {partners.map((p) => (
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
