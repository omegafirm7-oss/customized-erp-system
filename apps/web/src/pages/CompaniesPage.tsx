import { FormEvent, useEffect, useState } from "react";
import { apiClient } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useCompanies } from "../hooks/useCompanies";

interface JoinRequest {
  id: string;
  companyCode: string;
  companyName: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestedAt: string;
  decidedAt: string | null;
}

export function CompaniesPage() {
  const { companies, loading, reload } = useCompanies();
  const { switchCompany } = useAuth();
  const [form, setForm] = useState({ code: "", legalName: "", countryCode: "SA", baseCurrency: "SAR", taxRegistrationNumber: "" });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [joinCode, setJoinCode] = useState("");
  const [joinMessage, setJoinMessage] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinSubmitting, setJoinSubmitting] = useState(false);
  const [myRequests, setMyRequests] = useState<JoinRequest[]>([]);

  function loadMyRequests() {
    apiClient.get<JoinRequest[]>("/companies/join-requests/mine").then((res) => setMyRequests(res.data));
  }

  useEffect(() => {
    loadMyRequests();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const created = await apiClient.post("/companies", form);
      await reload();
      await switchCompany(created.data.id);
      setForm({ code: "", legalName: "", countryCode: "SA", baseCurrency: "SAR", taxRegistrationNumber: "" });
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create company");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRequestToJoin(e: FormEvent) {
    e.preventDefault();
    setJoinError(null);
    setJoinSubmitting(true);
    try {
      await apiClient.post("/companies/join-requests", { companyCode: joinCode, message: joinMessage || undefined });
      setJoinCode("");
      setJoinMessage("");
      loadMyRequests();
    } catch (err: any) {
      setJoinError(err?.response?.data?.message ?? "Failed to submit join request");
    } finally {
      setJoinSubmitting(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>Your companies</h2>
        {loading ? (
          <p>Loading…</p>
        ) : companies.length === 0 ? (
          <p>You don't belong to any company yet. Create one below.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Role</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.companyId}>
                  <td>{c.companyCode}</td>
                  <td>{c.companyName}</td>
                  <td>{c.roleName}</td>
                  <td>
                    <button className="secondary" onClick={() => switchCompany(c.companyId)}>
                      Switch to this company
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Create a company</h2>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={handleCreate}>
          <div className="form-row">
            <input placeholder="Code (e.g. ACME)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
            <input placeholder="Legal name" value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} required />
          </div>
          <div className="form-row">
            <input
              placeholder="Country code (e.g. SA)"
              value={form.countryCode}
              maxLength={2}
              onChange={(e) => setForm({ ...form, countryCode: e.target.value.toUpperCase() })}
              required
            />
            <input
              placeholder="Base currency (e.g. SAR)"
              value={form.baseCurrency}
              maxLength={3}
              onChange={(e) => setForm({ ...form, baseCurrency: e.target.value.toUpperCase() })}
              required
            />
            <input
              placeholder="VAT/TRN (optional)"
              value={form.taxRegistrationNumber}
              onChange={(e) => setForm({ ...form, taxRegistrationNumber: e.target.value })}
            />
          </div>
          <button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create company"}
          </button>
        </form>
      </div>

      <div className="card">
        <h2>Request to join a company</h2>
        {joinError && <div className="error-banner">{joinError}</div>}
        <form onSubmit={handleRequestToJoin}>
          <div className="form-row">
            <input placeholder="Company code" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} required />
            <input placeholder="Message (optional)" value={joinMessage} onChange={(e) => setJoinMessage(e.target.value)} />
          </div>
          <button type="submit" disabled={joinSubmitting}>
            {joinSubmitting ? "Submitting…" : "Request to join"}
          </button>
        </form>

        {myRequests.length > 0 && (
          <table style={{ marginTop: "1rem" }}>
            <thead>
              <tr>
                <th>Company</th>
                <th>Status</th>
                <th>Requested</th>
              </tr>
            </thead>
            <tbody>
              {myRequests.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.companyName} ({r.companyCode})
                  </td>
                  <td>{r.status}</td>
                  <td>{new Date(r.requestedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
