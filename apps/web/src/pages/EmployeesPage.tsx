import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiClient } from "../api/client";

interface Employee {
  id: string;
  code: string;
  nameEn: string;
  designation: string | null;
  nationality: string | null;
  isSaudi: boolean;
  iqamaExpiry: string | null;
  passportExpiry: string | null;
  status: string;
  basicSalary: string;
  housingAllowance: string;
  transportAllowance: string;
  otherAllowance: string;
  costCenter: { code: string; name: string } | null;
  loans: Array<{ id: string; loanNumber: string; balance: string }>;
  pendingAmount: string;
}

interface CostCenter {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

function grossOf(e: Employee): number {
  return (
    Number(e.basicSalary) + Number(e.housingAllowance) + Number(e.transportAllowance) + Number(e.otherAllowance)
  );
}

function expiryBadge(dateStr: string | null): JSX.Element | null {
  if (!dateStr) return null;
  const days = Math.floor((new Date(dateStr).getTime() - Date.now()) / (24 * 3600 * 1000));
  if (days < 0) return <span className="badge reversed">expired</span>;
  if (days <= 90) return <span className="badge draft">{days}d</span>;
  return null;
}

export function EmployeesPage() {
  const navigate = useNavigate();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    code: "",
    nameEn: "",
    designation: "",
    nationality: "",
    isSaudi: false,
    iqamaOrNationalId: "",
    joinDate: new Date().toISOString().slice(0, 10),
    bankCode: "",
    iban: "",
    costCenterId: "",
    basicSalary: "",
    housingAllowance: "",
    transportAllowance: "",
    otherAllowance: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [employeesRes, ccRes] = await Promise.all([
        apiClient.get<Employee[]>("/hr/employees"),
        apiClient.get<CostCenter[]>("/cost-centers"),
      ]);
      setEmployees(employeesRes.data);
      setCostCenters(ccRes.data.filter((c) => c.isActive));
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
      await apiClient.post("/hr/employees", {
        code: form.code,
        nameEn: form.nameEn,
        designation: form.designation || undefined,
        nationality: form.nationality || undefined,
        isSaudi: form.isSaudi,
        iqamaOrNationalId: form.iqamaOrNationalId || undefined,
        joinDate: form.joinDate,
        bankCode: form.bankCode || undefined,
        iban: form.iban || undefined,
        costCenterId: form.costCenterId || undefined,
        basicSalary: form.basicSalary || "0",
        housingAllowance: form.housingAllowance || "0",
        transportAllowance: form.transportAllowance || "0",
        otherAllowance: form.otherAllowance || "0",
      });
      setForm({ ...form, code: "", nameEn: "", designation: "", iqamaOrNationalId: "", iban: "", basicSalary: "", housingAllowance: "", transportAllowance: "", otherAllowance: "" });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create employee");
    } finally {
      setSubmitting(false);
    }
  }

  async function downloadTemplate() {
    const res = await apiClient.get("/hr/employees/import/template", { responseType: "blob" });
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "employees_import_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(file: File) {
    setError(null);
    setImportResult(null);
    const csv = await file.text();
    try {
      const res = await apiClient.post("/hr/employees/import", { csv });
      if (res.data.errors?.length > 0) {
        setError(res.data.errors.map((e: any) => `Row ${e.row}: ${e.message}`).join("; "));
      } else {
        setImportResult(`Imported ${res.data.imported} employees`);
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
          <h2>Employees</h2>
          <span>
            <button className="secondary" onClick={() => navigate("/hr/employees/overview")}>
              Overview
            </button>{" "}
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
                <th>Trade</th>
                <th>Nationality</th>
                <th>GOSI</th>
                <th>Gross salary</th>
                <th>Cost center</th>
                <th>Docs</th>
                <th>Loans</th>
                <th>Pending</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id}>
                  <td>
                    <Link to={`/hr/employees/${e.id}`}>{e.code}</Link>
                  </td>
                  <td>{e.nameEn}</td>
                  <td>{e.designation ?? "—"}</td>
                  <td>{e.nationality ?? "—"}</td>
                  <td>{e.isSaudi ? "Saudi" : "Expat"}</td>
                  <td>{grossOf(e).toFixed(2)}</td>
                  <td>{e.costCenter?.code ?? "—"}</td>
                  <td>
                    {expiryBadge(e.iqamaExpiry)} {expiryBadge(e.passportExpiry)}
                  </td>
                  <td>{e.loans.length > 0 ? e.loans.map((l) => l.loanNumber).join(", ") : "—"}</td>
                  <td>{Number(e.pendingAmount).toFixed(2)}</td>
                  <td>
                    <span className={`badge ${e.status === "ACTIVE" ? "posted" : "reversed"}`}>{e.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>New employee</h3>
        <form onSubmit={handleCreate}>
          <div className="form-row">
            <input placeholder="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
            <input placeholder="Name (English)" value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} required style={{ flex: 1 }} />
            <input placeholder="Designation / Trade" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} style={{ width: 130 }} />
            <input placeholder="Nationality" value={form.nationality} onChange={(e) => setForm({ ...form, nationality: e.target.value })} style={{ width: 90 }} />
            <label>
              <input type="checkbox" checked={form.isSaudi} onChange={(e) => setForm({ ...form, isSaudi: e.target.checked })} /> Saudi
            </label>
            <input placeholder="Iqama / National ID" value={form.iqamaOrNationalId} onChange={(e) => setForm({ ...form, iqamaOrNationalId: e.target.value })} />
            <div>
              <label>Joined </label>
              <input type="date" value={form.joinDate} onChange={(e) => setForm({ ...form, joinDate: e.target.value })} required />
            </div>
          </div>
          <div className="form-row">
            <input placeholder="Bank code" value={form.bankCode} onChange={(e) => setForm({ ...form, bankCode: e.target.value })} style={{ width: 90 }} />
            <input placeholder="IBAN" value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} style={{ flex: 1 }} />
            <select value={form.costCenterId} onChange={(e) => setForm({ ...form, costCenterId: e.target.value })}>
              <option value="">No cost center</option>
              {costCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <input type="number" min="0" step="0.01" placeholder="Basic salary" value={form.basicSalary} onChange={(e) => setForm({ ...form, basicSalary: e.target.value })} />
            <input type="number" min="0" step="0.01" placeholder="Housing" value={form.housingAllowance} onChange={(e) => setForm({ ...form, housingAllowance: e.target.value })} />
            <input type="number" min="0" step="0.01" placeholder="Transport" value={form.transportAllowance} onChange={(e) => setForm({ ...form, transportAllowance: e.target.value })} />
            <input type="number" min="0" step="0.01" placeholder="Food" value={form.otherAllowance} onChange={(e) => setForm({ ...form, otherAllowance: e.target.value })} />
            <button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
