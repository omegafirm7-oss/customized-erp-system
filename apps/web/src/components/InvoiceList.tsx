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
  lines?: Array<{
    id: string;
    expenseAccount?: { code: string; name: string } | null;
    costCenter?: { code: string; name: string } | null;
    attachment?: { filename: string } | null;
  }>;
  zatcaSubmission?: {
    id: string;
    status: "PENDING" | "CLEARED" | "REPORTED" | "REJECTED" | "FAILED";
    invoiceKind: "STANDARD" | "SIMPLIFIED";
    errors: unknown;
  } | null;
}

// AP invoices from the Excel expense import are always single-line, so the
// first line's account/cost-center IS the invoice's account/cost-center for
// display purposes — a multi-line manually-created invoice would show only
// its first line here, which is an accepted simplification for this list view.
function accountSummary(inv: InvoiceRow): string {
  const acct = inv.lines?.[0]?.expenseAccount;
  return acct ? `${acct.code} ${acct.name}` : "—";
}
function costCenterSummary(inv: InvoiceRow): string {
  const cc = inv.lines?.[0]?.costCenter;
  return cc ? cc.code : "—";
}

const STATUS_FILTERS = ["ALL", "DRAFT", "POSTED", "PARTIALLY_PAID", "PAID", "CANCELLED"];

interface VendorRef {
  id: string;
  code: string;
  name: string;
  partnerType: "CUSTOMER" | "VENDOR" | "BOTH";
}

export function InvoiceList({ side }: { side: "ar" | "ap" }) {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qrView, setQrView] = useState<{ invoiceNumber: string; dataUrl: string } | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [vendors, setVendors] = useState<VendorRef[]>([]);
  const [vendorSearch, setVendorSearch] = useState("");
  const [selectedVendors, setSelectedVendors] = useState<VendorRef[]>([]);
  const [accountSearch, setAccountSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [dateSort, setDateSort] = useState<"asc" | "desc">("desc");
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ url: string; filename: string } | null>(null);

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

  useEffect(() => {
    if (side !== "ap") return;
    apiClient.get<VendorRef[]>("/partners").then((res) => setVendors(res.data.filter((p) => p.partnerType === "VENDOR" || p.partnerType === "BOTH")));
  }, [side]);

  const vendorMatches =
    side === "ap" && vendorSearch.trim().length > 0
      ? vendors.filter(
          (v) =>
            !selectedVendors.some((sv) => sv.id === v.id) &&
            (v.name.toLowerCase().includes(vendorSearch.toLowerCase()) || v.code.toLowerCase().includes(vendorSearch.toLowerCase())),
        )
      : [];

  function selectVendor(v: VendorRef) {
    setSelectedVendors((prev) => (prev.some((sv) => sv.id === v.id) ? prev : [...prev, v]));
    setVendorSearch("");
  }
  function deselectVendor(id: string) {
    setSelectedVendors((prev) => prev.filter((v) => v.id !== id));
  }

  // Vendor (multi-select, e.g. "KPS" + "Fuel supplier"), account-name/code
  // substring match (e.g. "fuel" matches "5103 Fuel and Lubricants"), and
  // posting-date range — all applied client-side on top of the server-side
  // status filter, so a user reviewing DRAFT expenses for correction can
  // narrow straight to "which fuel invoices from these two vendors in July".
  const filteredInvoices = invoices.filter((inv) => {
    if (side === "ap" && selectedVendors.length > 0) {
      if (!selectedVendors.some((v) => v.code === inv.businessPartner?.code)) return false;
    }
    if (side === "ap" && accountSearch.trim()) {
      if (!accountSummary(inv).toLowerCase().includes(accountSearch.trim().toLowerCase())) return false;
    }
    if (side === "ap" && (fromDate || toDate)) {
      const posting = inv.postingDate.slice(0, 10);
      if (fromDate && posting < fromDate) return false;
      if (toDate && posting > toDate) return false;
    }
    return true;
  }).sort((a, b) => (dateSort === "asc" ? a.postingDate.localeCompare(b.postingDate) : b.postingDate.localeCompare(a.postingDate)));

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

  async function uploadLineAttachment(lineId: string, file: File) {
    setUploadingFor(lineId);
    try {
      const form = new FormData();
      form.append("file", file);
      await apiClient.post(`/ap/invoices/lines/${lineId}/attachment`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      await load();
    } finally {
      setUploadingFor(null);
    }
  }

  async function viewLineAttachment(lineId: string, filename: string) {
    const res = await apiClient.get(`/ap/invoices/lines/${lineId}/attachment`, { responseType: "blob" });
    const url = URL.createObjectURL(res.data as Blob);
    setViewer({ url, filename });
  }

  function closeViewer() {
    if (viewer) URL.revokeObjectURL(viewer.url);
    setViewer(null);
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
      {side === "ap" && (
        <>
          <div className="form-row" style={{ position: "relative" }}>
            <input
              placeholder="Select vendor (e.g. KPS)…"
              value={vendorSearch}
              onChange={(e) => setVendorSearch(e.target.value)}
              style={{ maxWidth: 220 }}
            />
            {vendorMatches.length > 0 && (
              <div
                className="card"
                style={{ position: "absolute", top: "100%", left: 0, zIndex: 10, maxHeight: 240, overflowY: "auto", padding: 4, minWidth: 300 }}
              >
                {vendorMatches.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className="secondary"
                    style={{ display: "block", width: "100%", textAlign: "left", border: "none", padding: "6px 10px" }}
                    onClick={() => selectVendor(v)}
                  >
                    {v.code} — {v.name}
                  </button>
                ))}
              </div>
            )}
            <input
              placeholder="Search account (e.g. fuel)…"
              value={accountSearch}
              onChange={(e) => setAccountSearch(e.target.value)}
              style={{ maxWidth: 220 }}
            />
            <label>Period from </label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            <label>to </label>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            {(selectedVendors.length > 0 || accountSearch || fromDate || toDate) && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setSelectedVendors([]);
                  setAccountSearch("");
                  setFromDate("");
                  setToDate("");
                }}
              >
                Clear filters
              </button>
            )}
          </div>
          {selectedVendors.length > 0 && (
            <div className="form-row">
              {selectedVendors.map((v) => (
                <span
                  key={v.id}
                  className="badge posted"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "default" }}
                >
                  {v.code} — {v.name}
                  <button
                    type="button"
                    onClick={() => deselectVendor(v.id)}
                    style={{ background: "none", border: "none", padding: 0, boxShadow: "none", color: "inherit", cursor: "pointer", fontWeight: 700 }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </>
      )}
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
              <th>#</th>
              <th>Number</th>
              {side === "ap" && <th>Vendor Ref</th>}
              {side === "ar" && <th>Kind</th>}
              <th>Partner</th>
              {side === "ap" && <th>Account</th>}
              {side === "ap" && <th>Project</th>}
              <th style={{ cursor: "pointer" }} onClick={() => setDateSort((d) => (d === "asc" ? "desc" : "asc"))}>
                Posting Date {dateSort === "asc" ? "▲" : "▼"}
              </th>
              <th>Due Date</th>
              <th>Gross</th>
              <th>Open</th>
              <th>Status</th>
              {side === "ar" && <th>ZATCA</th>}
              {side === "ap" && <th>Evidence</th>}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredInvoices.map((inv, idx) => (
              <tr key={inv.id}>
                <td>{idx + 1}</td>
                <td>{inv.invoiceNumber ?? "—"}</td>
                {side === "ap" && <td>{inv.vendorInvoiceNumber}</td>}
                {side === "ar" && <td>{inv.documentKind === "CREDIT_NOTE" ? "Credit Note" : "Invoice"}</td>}
                <td>{inv.businessPartner ? `${inv.businessPartner.name}` : ""}</td>
                {side === "ap" && <td>{accountSummary(inv)}</td>}
                {side === "ap" && <td>{costCenterSummary(inv)}</td>}
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
                {side === "ap" && (
                  <td>
                    {(inv.lines ?? []).map((l) => (
                      <div key={l.id} style={{ marginBottom: 2 }}>
                        {l.attachment ? (
                          <button className="secondary" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => viewLineAttachment(l.id, l.attachment!.filename)}>
                            View
                          </button>
                        ) : (
                          <label style={{ cursor: "pointer", color: "#1e4fa3", fontSize: 12 }}>
                            {uploadingFor === l.id ? "Uploading…" : "Attach"}
                            <input
                              type="file"
                              accept="image/*,.pdf"
                              style={{ display: "none" }}
                              disabled={uploadingFor === l.id}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) uploadLineAttachment(l.id, file);
                                e.target.value = "";
                              }}
                            />
                          </label>
                        )}
                      </div>
                    ))}
                  </td>
                )}
                <td>
                  {inv.status === "DRAFT" && (
                    <>
                      <button disabled={busyId === inv.id} onClick={() => action(inv.id, "post")}>
                        Post
                      </button>{" "}
                      {side === "ap" && (
                        <>
                          <Link to={`/ap/invoices/${inv.id}/edit`}>
                            <button type="button" className="secondary" disabled={busyId === inv.id}>
                              Edit
                            </button>
                          </Link>{" "}
                        </>
                      )}
                      <button className="danger" disabled={busyId === inv.id} onClick={() => remove(inv.id)}>
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
          <tfoot>
            <tr>
              <td colSpan={5 + (side === "ap" ? 3 : 0) + (side === "ar" ? 1 : 0)}>
                <strong>
                  {filteredInvoices.length} invoices
                  {filteredInvoices.length !== invoices.length ? ` (of ${invoices.length})` : ""}
                </strong>
              </td>
              <td>
                <strong>{filteredInvoices.reduce((sum, inv) => sum + Number(inv.grossTotal), 0).toFixed(2)}</strong>
              </td>
              <td>
                <strong>{filteredInvoices.reduce((sum, inv) => sum + Number(inv.openAmount), 0).toFixed(2)}</strong>
              </td>
              <td colSpan={2 + (side === "ar" ? 1 : 0) + (side === "ap" ? 1 : 0)} />
            </tr>
          </tfoot>
        </table>
      )}

      {viewer && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={closeViewer}
        >
          <div style={{ background: "#fff", padding: 16, borderRadius: 8, maxWidth: "90vw", maxHeight: "90vh" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <strong>{viewer.filename}</strong>
              <button className="secondary" onClick={closeViewer}>
                Close
              </button>
            </div>
            {viewer.filename.toLowerCase().endsWith(".pdf") ? (
              <iframe src={viewer.url} title={viewer.filename} style={{ width: "80vw", height: "80vh", border: "none" }} />
            ) : (
              <img src={viewer.url} alt={viewer.filename} style={{ maxWidth: "80vw", maxHeight: "80vh", objectFit: "contain" }} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
