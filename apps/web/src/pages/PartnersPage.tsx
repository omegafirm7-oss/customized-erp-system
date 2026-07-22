import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiClient } from "../api/client";

interface Partner {
  id: string;
  code: string;
  name: string;
  partnerType: "CUSTOMER" | "VENDOR" | "BOTH";
  taxRegistrationNumber: string | null;
  isActive: boolean;
}

export function PartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [form, setForm] = useState({ code: "", name: "", partnerType: "CUSTOMER", taxRegistrationNumber: "" });
  const [submitting, setSubmitting] = useState(false);

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
      setForm({ code: "", name: "", partnerType: "CUSTOMER", taxRegistrationNumber: "" });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create partner");
    } finally {
      setSubmitting(false);
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
            </label>
          </span>
        </div>
        {importResult && <p style={{ color: "#027a48" }}>{importResult}</p>}
        {error && <div className="error-banner">{error}</div>}
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
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => (
                <tr key={p.id}>
                  <td>{p.code}</td>
                  <td>{p.name}</td>
                  <td>{p.partnerType}</td>
                  <td>{p.taxRegistrationNumber ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>New partner</h3>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={handleCreate}>
          <div className="form-row">
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
          </div>
        </form>
      </div>
    </div>
  );
}
