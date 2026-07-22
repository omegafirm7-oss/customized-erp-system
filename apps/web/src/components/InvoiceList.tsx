import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import QRCode from "qrcode";
import { apiClient } from "../api/client";

interface InvoiceRow {
  id: string;
  invoiceNumber: string | null;
  vendorInvoiceNumber?: string;
  documentKind?: "INVOICE" | "CREDIT_NOTE";
  status: string;
  postingDate: string;
  dueDate: string;
  grossTotal: string;
  openAmount: string;
  businessPartner?: { code: string; name: string };
  zatcaSubmission?: {
    id: string;
    status: "PENDING" | "CLEARED" | "REPORTED" | "REJECTED" | "FAILED";
    invoiceKind: "STANDARD" | "SIMPLIFIED";
    errors: unknown;
  } | null;
}

const STATUS_FILTERS = ["ALL", "DRAFT", "POSTED", "PARTIALLY_PAID", "PAID", "CANCELLED"];

export function InvoiceList({ side }: { side: "ar" | "ap" }) {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qrView, setQrView] = useState<{ invoiceNumber: string; dataUrl: string } | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = statusFilter !== "ALL" ? { status: statusFilter } : {};
    return apiClient
      .get<InvoiceRow[]>(`/${side}/invoices`, { params })
      .then((res) => setInvoices(res.data))
      .finally(() => setLoading(false));
  }, [side, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function action(id: string, verb: "post" | "cancel") {
    setError(null);
    setBusyId(id);
    try {
      await apiClient.post(`/${side}/invoices/${id}/${verb}`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? `Failed to ${verb} invoice`);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setError(null);
    setBusyId(id);
    try {
      await apiClient.delete(`/${side}/invoices/${id}`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to delete draft");
    } finally {
      setBusyId(null);
    }
  }

  async function retryZatca(submissionId: string, invoiceId: string) {
    setError(null);
    setBusyId(invoiceId);
    try {
      await apiClient.post(`/zatca/submissions/${submissionId}/retry`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "ZATCA retry failed");
    } finally {
      setBusyId(null);
    }
  }

  async function downloadXml(sub: NonNullable<InvoiceRow["zatcaSubmission"]>, invoiceNumber: string) {
    setError(null);
    try {
      // Fetch through the authenticated client (a plain <a href> would carry
      // no Authorization header) and hand the result to the browser as a blob.
      const res = await apiClient.get(`/zatca/submissions/${sub.id}/xml`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${invoiceNumber}.xml`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "XML download failed");
    }
  }

  async function showQr(inv: InvoiceRow) {
    setError(null);
    try {
      const detail = await apiClient.get(`/ar/invoices/${inv.id}`);
      const qrBase64: string | null = detail.data?.zatcaSubmission?.qrCode ?? null;
      if (!qrBase64) {
        setError("No QR code available for this invoice yet");
        return;
      }
      const dataUrl = await QRCode.toDataURL(qrBase64, { width: 240, margin: 1 });
      setQrView({ invoiceNumber: inv.invoiceNumber ?? inv.id, dataUrl });
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to load QR");
    }
  }

  function zatcaBadge(inv: InvoiceRow) {
    const sub = inv.zatcaSubmission;
    if (!sub) return <span style={{ color: "#98a2b3" }}>—</span>;
    const cls = sub.status === "CLEARED" || sub.status === "REPORTED" ? "posted" : sub.status === "REJECTED" ? "reversed" : "draft";
    const title = sub.status === "REJECTED" && sub.errors ? JSON.stringify(sub.errors).slice(0, 300) : sub.invoiceKind;
    return (
      <>
        <span className={`badge ${cls}`} title={title}>
          {sub.status}
        </span>{" "}
        {(sub.status === "FAILED" || sub.status === "PENDING") && (
          <button className="secondary" disabled={busyId === inv.id} onClick={() => retryZatca(sub.id, inv.id)}>
            Retry
          </button>
        )}
        {(sub.status === "CLEARED" || sub.status === "REPORTED") && (
          <>
            <button
              className="secondary"
              style={{ padding: "2px 8px", fontSize: 11 }}
              onClick={() => downloadXml(sub, inv.invoiceNumber ?? inv.id)}
            >
              XML
            </button>{" "}
            <button className="secondary" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => showQr(inv)}>
              QR
            </button>
          </>
        )}
      </>
    );
  }

  const title = side === "ar" ? "Sales Invoices" : "Purchase Invoices";

  async function downloadExpenseTemplate() {
    const res = await apiClient.get("/ap/invoices/import/expenses/template", { responseType: "blob" });
    const url = URL.createObjectURL(res.data as Blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "expenses_import_template.xlsx";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportExpenses(file: File) {
    setError(null);
    setImportResult(null);
    const formData = new FormData();
    formData.append("file", file);
    try {
      // Do NOT set Content-Type manually — the browser/axios must generate
      // the multipart boundary itself; a hardcoded header here breaks parsing.
      const res = await apiClient.post("/ap/invoices/import/expenses", formData);
      if (res.data.errors?.length > 0) {
        setError(res.data.errors.map((e: any) => `Row ${e.row}: ${e.message}`).join("; "));
      } else {
        setImportResult(`Imported ${res.data.imported} expense invoices (drafts — review and post as usual)`);
        await load();
      }
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Expense import failed");
    }
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>{title}</h2>
        <span>
          {side === "ap" && (
            <>
              <button className="secondary" onClick={downloadExpenseTemplate}>
                Download Excel template
              </button>{" "}
              <label className="secondary" style={{ cursor: "pointer", padding: "6px 12px", border: "1px solid #d0d5dd", borderRadius: 6 }}>
                Import Expenses (Excel)
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImportExpenses(file);
                    e.target.value = "";
                  }}
                />
              </label>{" "}
            </>
          )}
          <Link to={`/${side}/invoices/new`}>
            <button>New {side === "ar" ? "sales" : "purchase"} invoice</button>
          </Link>
        </span>
      </div>
      <div className="form-row">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            className={s === statusFilter ? "" : "secondary"}
            onClick={() => setStatusFilter(s)}
            type="button"
          >
            {s.replace("_", " ")}
          </button>
        ))}
      </div>
      {importResult && <p style={{ color: "#027a48" }}>{importResult}</p>}
      {error && <div className="error-banner">{error}</div>}
      {qrView && (
        <div className="card" style={{ textAlign: "center" }}>
          <h3>ZATCA QR — {qrView.invoiceNumber}</h3>
          <img src={qrView.dataUrl} alt="ZATCA QR code" />
          <div>
            <button className="secondary" onClick={() => setQrView(null)}>
              Close
            </button>
          </div>
        </div>
      )}
      {loading ? (
        <p>Loading…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Number</th>
              {side === "ap" && <th>Vendor Ref</th>}
              {side === "ar" && <th>Kind</th>}
              <th>Partner</th>
              <th>Posting Date</th>
              <th>Due Date</th>
              <th>Gross</th>
              <th>Open</th>
              <th>Status</th>
              {side === "ar" && <th>ZATCA</th>}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td>{inv.invoiceNumber ?? "—"}</td>
                {side === "ap" && <td>{inv.vendorInvoiceNumber}</td>}
                {side === "ar" && <td>{inv.documentKind === "CREDIT_NOTE" ? "Credit Note" : "Invoice"}</td>}
                <td>{inv.businessPartner ? `${inv.businessPartner.name}` : ""}</td>
                <td>{new Date(inv.postingDate).toLocaleDateString()}</td>
                <td>{new Date(inv.dueDate).toLocaleDateString()}</td>
                <td>{Number(inv.grossTotal).toFixed(2)}</td>
                <td>{Number(inv.openAmount).toFixed(2)}</td>
                <td>
                  <span className={`badge ${inv.status === "DRAFT" ? "draft" : inv.status === "CANCELLED" ? "reversed" : "posted"}`}>
                    {inv.status.replace("_", " ")}
                  </span>
                </td>
                {side === "ar" && <td>{zatcaBadge(inv)}</td>}
                <td>
                  {inv.status === "DRAFT" && (
                    <>
                      <button disabled={busyId === inv.id} onClick={() => action(inv.id, "post")}>
                        Post
                      </button>{" "}
                      <button className="secondary" disabled={busyId === inv.id} onClick={() => remove(inv.id)}>
                        Delete
                      </button>
                    </>
                  )}
                  {inv.status === "POSTED" && Number(inv.openAmount) === Number(inv.grossTotal) && (
                    <button className="secondary" disabled={busyId === inv.id} onClick={() => action(inv.id, "cancel")}>
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
