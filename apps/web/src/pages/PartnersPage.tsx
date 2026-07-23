import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../api/client";

interface Partner {
  id: string;
  code: string;
  name: string;
  partnerType: "CUSTOMER" | "VENDOR" | "BOTH";
  taxRegistrationNumber: string | null;
  isActive: boolean;
}

const emptyForm = { code: "", name: "", partnerType: "CUSTOMER", taxRegistrationNumber: "" };

export function PartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    return apiClient
      .get<Partner[]>("/partners")
      .then((res) => setPartners(res.data))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredPartners = useMemo(() => {
    if (!search.trim()) return partners;
    const q = search.trim().toLowerCase();
    return partners.filter((p) => p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
  }, [partners, search]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.post("/partners", {
        code: form.code,
        name: form.name,
        partnerType: form.partnerType,
        taxRegistrationNumber: form.taxRegistrationNumber || undefined,
      });
      setForm(emptyForm);
      setShowAddForm(false);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create partner");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(p: Partner) {
    setEditingId(p.id);
    setEditForm({ code: p.code, name: p.name, partnerType: p.partnerType, taxRegistrationNumber: p.taxRegistrationNumber ?? "" });
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setError(null);
    setBusyId(editingId);
    try {
      await apiClient.patch(`/partners/${editingId}`, {
        code: editForm.code,
        name: editForm.name,
        partnerType: editForm.partnerType,
        taxRegistrationNumber: editForm.taxRegistrationNumber || undefined,
      });
      setEditingId(null);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to update partner");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(p: Partner) {
    if (!window.confirm(`Deactivate ${p.code} — ${p.name}? It will be hidden from new invoices/orders but existing history is kept.`)) {
      return;
    }
    setError(null);
    setBusyId(p.id);
    try {
      await apiClient.delete(`/partners/${p.id}`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to deactivate partner");
    } finally {
      setBusyId(null);
    }
  }

  async function downloadTemplate() {
    const res = await apiClient.get("/partners/import/template", { responseType: "blob" });
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "partners_import_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(file: File) {
    setError(null);
    setImportResult(null);
    const csv = await file.text();
    try {
      const res = await apiClient.post("/partners/import", { csv });
      if (res.data.errors?.length > 0) {
        setError(res.data.errors.map((e: any) => `Row ${e.row}: ${e.message}`).join("; "));
      } else {
        setImportResult(`Imported ${res.data.imported} partners`);
        await load();
      }
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Import failed");
    }
  }

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>Business Partners</h2>
          <span>
            <button className="secondary" onClick={downloadTemplate}>
              Download import template
            </button>{" "}
            <label className="secondary" style={{ cursor: "pointer", padding: "6px 12px", border: "1px solid #d0d5dd", borderRadius: 6 }}>
              Import CSV
              <input
                type="file"
                accept=".csv,text/csv"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImportFile(file);
                  e.target.value = "";
                }}
              />
            </label>{" "}
            <button onClick={() => setShowAddForm((v) => !v)}>{showAddForm ? "Cancel" : "+ Add vendor / customer"}</button>
          </span>
        </div>
        {importResult && <p style={{ color: "#027a48" }}>{importResult}</p>}
        {error && <div className="error-banner">{error}</div>}

        {showAddForm && (
          <form onSubmit={handleCreate} className="form-row" style={{ marginBottom: 14 }}>
            <input placeholder="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
            <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required style={{ flex: 1 }} />
            <select value={form.partnerType} onChange={(e) => setForm({ ...form, partnerType: e.target.value })}>
              <option value="CUSTOMER">Customer</option>
              <option value="VENDOR">Vendor</option>
              <option value="BOTH">Both</option>
            </select>
            <input
              placeholder="VAT/TRN (optional)"
              value={form.taxRegistrationNumber}
              onChange={(e) => setForm({ ...form, taxRegistrationNumber: e.target.value })}
            />
            <button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create"}
            </button>
          </form>
        )}

        <div className="form-row">
          <input
            placeholder="Search vendors / customers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 280 }}
          />
        </div>

        {loading ? (
          <p>Loading…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Type</th>
                <th>VAT/TRN</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredPartners.map((p) =>
                editingId === p.id ? (
                  <tr key={p.id}>
                    <td colSpan={6}>
                      <form onSubmit={saveEdit} className="form-row" style={{ margin: 0 }}>
                        <input value={editForm.code} onChange={(e) => setEditForm({ ...editForm, code: e.target.value })} required style={{ width: 100 }} />
                        <input
                          value={editForm.name}
                          onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                          required
                          style={{ flex: 1 }}
                        />
                        <select value={editForm.partnerType} onChange={(e) => setEditForm({ ...editForm, partnerType: e.target.value })}>
                          <option value="CUSTOMER">Customer</option>
                          <option value="VENDOR">Vendor</option>
                          <option value="BOTH">Both</option>
                        </select>
                        <input
                          placeholder="VAT/TRN"
                          value={editForm.taxRegistrationNumber}
                          onChange={(e) => setEditForm({ ...editForm, taxRegistrationNumber: e.target.value })}
                        />
                        <button type="submit" disabled={busyId === p.id}>
                          Save
                        </button>
                        <button type="button" className="secondary" onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                      </form>
                    </td>
                  </tr>
                ) : (
                  <tr key={p.id} style={{ opacity: p.isActive ? 1 : 0.55 }}>
                    <td>
                      <Link to={`/partners/${p.id}`}>{p.code}</Link>
                    </td>
                    <td>{p.name}</td>
                    <td>{p.partnerType}</td>
                    <td>{p.taxRegistrationNumber ?? "—"}</td>
                    <td>
                      <span className={`badge ${p.isActive ? "posted" : "reversed"}`}>{p.isActive ? "Active" : "Inactive"}</span>
                    </td>
                    <td>
                      <button type="button" className="secondary" disabled={busyId === p.id} onClick={() => startEdit(p)}>
                        Edit
                      </button>{" "}
                      {p.isActive && (
                        <button type="button" className="danger" disabled={busyId === p.id} onClick={() => handleDelete(p)}>
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ),
              )}
              {filteredPartners.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ color: "#98a2b3" }}>
                    No partners match "{search}"
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
