import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiClient } from "../api/client";
import { AttachButton } from "../components/AttachButton";
import { AttachmentViewer } from "../components/AttachmentViewer";

interface InvoiceLineRow {
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
  accountCode: string;
  accountName: string;
  attachmentFilename: string | null;
}

interface LaborRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  hoursWorked: string;
  hourlyRate: string;
  salaryCost: string;
  foodCost: string;
  totalCost: string;
}

interface InvoiceDetail {
  month: string;
  category: "MATERIAL" | "MACHINERY";
  rows: InvoiceLineRow[];
}

interface LaborDetail {
  month: string;
  category: "LABOR";
  rows: LaborRow[];
}

const CATEGORY_LABELS: Record<string, string> = { material: "Material", machinery: "Machinery", labor: "Labor" };

function formatMonthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function ProjectMonthlyCostTrendDetailPage() {
  const { id, month, category } = useParams<{ id: string; month: string; category: string }>();
  const isLabor = category === "labor";
  const [invoiceData, setInvoiceData] = useState<InvoiceDetail | null>(null);
  const [laborData, setLaborData] = useState<LaborDetail | null>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ lineId: string; filename: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    if (!id || !month || !category) return;
    setInvoiceData(null);
    setLaborData(null);
    apiClient.get(`/projects/${id}/monthly-cost-trend/${month}/${category}`).then((res) => {
      if (isLabor) setLaborData(res.data);
      else setInvoiceData(res.data);
    });
  }

  useEffect(load, [id, month, category]); // eslint-disable-line react-hooks/exhaustive-deps

  async function uploadAttachment(lineId: string, file: File) {
    setError(null);
    setUploadingFor(lineId);
    try {
      const form = new FormData();
      form.append("file", file);
      await apiClient.post(`/ap/invoices/lines/${lineId}/attachment`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to attach evidence — the file may be too large or an unsupported type");
    } finally {
      setUploadingFor(null);
    }
  }

  if (!month || !category || (!invoiceData && !laborData)) {
    return <p style={{ padding: 24 }}>Loading…</p>;
  }

  const monthLabel = formatMonthLabel(month);
  const categoryLabel = CATEGORY_LABELS[category] ?? category;

  const total = isLabor
    ? (laborData?.rows ?? []).reduce((sum, r) => sum + Number(r.totalCost), 0)
    : (invoiceData?.rows ?? []).reduce((sum, r) => sum + Number(r.grossAmount), 0);

  return (
    <div className="intelligence-board">
      <Link to={`/projects/${id}`} className="intelligence-crumb">
        ← Back to project
      </Link>
      {error && <div className="error-banner">{error}</div>}
      <div className="intelligence-panel-header">
        <div className="intelligence-panel-title">
          {categoryLabel} cost — {monthLabel}
        </div>
        <div className="intelligence-total-pill">
          <div className="label">Total</div>
          <div className="value">{total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </div>
      </div>

      {isLabor ? (
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Hours worked</th>
              <th>Hourly rate</th>
              <th>Salary cost</th>
              <th>Food cost</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {(laborData?.rows ?? []).map((r) => (
              <tr key={r.employeeId}>
                <td>
                  <Link to={`/hr/employees/${r.employeeId}`}>
                    {r.employeeCode} — {r.employeeName}
                  </Link>
                </td>
                <td>{Number(r.hoursWorked).toFixed(2)}</td>
                <td>{Number(r.hourlyRate).toFixed(2)}</td>
                <td>{Number(r.salaryCost).toFixed(2)}</td>
                <td>{Number(r.foodCost).toFixed(2)}</td>
                <td style={{ fontWeight: 600 }}>{Number(r.totalCost).toFixed(2)}</td>
              </tr>
            ))}
            {(laborData?.rows ?? []).length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: "#98a2b3" }}>
                  No labor cost accrued this month
                </td>
              </tr>
            )}
          </tbody>
        </table>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Account</th>
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
            {(invoiceData?.rows ?? []).map((l) => (
              <tr key={l.lineId}>
                <td>
                  {l.accountCode} — {l.accountName}
                </td>
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
                    <button className="secondary" onClick={() => setViewer({ lineId: l.lineId, filename: l.attachmentFilename! })}>
                      View
                    </button>
                  ) : (
                    <AttachButton uploading={uploadingFor === l.lineId} onFile={(file) => uploadAttachment(l.lineId, file)} />
                  )}
                </td>
              </tr>
            ))}
            {(invoiceData?.rows ?? []).length === 0 && (
              <tr>
                <td colSpan={10} style={{ color: "#98a2b3" }}>
                  No {categoryLabel.toLowerCase()} costs recorded this month
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {viewer && (
        <AttachmentViewer
          filename={viewer.filename}
          fetchBlob={() =>
            apiClient.get(`/ap/invoices/lines/${viewer.lineId}/attachment`, { responseType: "blob" }).then((res) => res.data as Blob)
          }
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}
