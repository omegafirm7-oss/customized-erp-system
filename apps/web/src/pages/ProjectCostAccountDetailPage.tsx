import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiClient } from "../api/client";

interface InvoiceLine {
  lineId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  vendorInvoiceNumber: string;
  partnerName: string;
  postingDate: string;
  description: string;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
  status: string;
  attachmentFilename: string | null;
}

export function ProjectCostAccountDetailPage() {
  const { id, accountId } = useParams<{ id: string; accountId: string }>();
  const [lines, setLines] = useState<InvoiceLine[] | null>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ url: string; filename: string } | null>(null);

  function load() {
    if (!id || !accountId) return;
    apiClient
      .get<InvoiceLine[]>(`/projects/${id}/costs/accounts/${accountId}/invoice-lines`)
      .then((res) => setLines(res.data));
  }

  useEffect(load, [id, accountId]);

  async function uploadAttachment(lineId: string, file: File) {
    setUploadingFor(lineId);
    try {
      const form = new FormData();
      form.append("file", file);
      await apiClient.post(`/ap/invoices/lines/${lineId}/attachment`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      load();
    } finally {
      setUploadingFor(null);
    }
  }

  async function viewAttachment(lineId: string, filename: string) {
    const res = await apiClient.get(`/ap/invoices/lines/${lineId}/attachment`, { responseType: "blob" });
    const url = URL.createObjectURL(res.data);
    setViewer({ url, filename });
  }

  function closeViewer() {
    if (viewer) URL.revokeObjectURL(viewer.url);
    setViewer(null);
  }

  if (!lines) return <p style={{ padding: 24 }}>Loading…</p>;

  const totalNet = lines.reduce((sum, l) => sum + Number(l.netAmount), 0);
  const totalGross = lines.reduce((sum, l) => sum + Number(l.grossAmount), 0);

  return (
    <div className="intelligence-board">
      <Link to={`/projects/${id}`} className="intelligence-crumb">
        ← Back to project
      </Link>
      <div className="intelligence-panel-header">
        <div className="intelligence-panel-title">Recorded purchase invoice lines</div>
        <div style={{ display: "flex", gap: 12 }}>
          <div className="intelligence-total-pill">
            <div className="label">Net</div>
            <div className="value">{totalNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
          <div className="intelligence-total-pill">
            <div className="label">Gross</div>
            <div className="value">{totalGross.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Vendor</th>
            <th>Vendor Ref</th>
            <th>Posting Date</th>
            <th>Description</th>
            <th>Net</th>
            <th>VAT</th>
            <th>Gross</th>
            <th>Status</th>
            <th>Evidence</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>{l.partnerName}</td>
              <td>{l.vendorInvoiceNumber}</td>
              <td>{new Date(l.postingDate).toLocaleDateString()}</td>
              <td>{l.description}</td>
              <td>{Number(l.netAmount).toFixed(2)}</td>
              <td>{Number(l.vatAmount).toFixed(2)}</td>
              <td>{Number(l.grossAmount).toFixed(2)}</td>
              <td>
                <span className={`badge ${l.status === "DRAFT" ? "draft" : "posted"}`}>{l.status}</span>{" "}
                {l.status === "DRAFT" && <Link to={`/ap/invoices/${l.invoiceId}/edit`}>Edit</Link>}
              </td>
              <td>
                {l.attachmentFilename ? (
                  <button className="secondary" onClick={() => viewAttachment(l.lineId, l.attachmentFilename!)}>
                    View
                  </button>
                ) : (
                  <label style={{ cursor: "pointer", color: "#1e4fa3", fontSize: 13 }}>
                    {uploadingFor === l.lineId ? "Uploading…" : "Attach"}
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      style={{ display: "none" }}
                      disabled={uploadingFor === l.lineId}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) uploadAttachment(l.lineId, file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
              </td>
            </tr>
          ))}
          {lines.length === 0 && (
            <tr>
              <td colSpan={9} style={{ color: "#98a2b3" }}>
                No invoice lines recorded yet
              </td>
            </tr>
          )}
        </tbody>
      </table>

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
