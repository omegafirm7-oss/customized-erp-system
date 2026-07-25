import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiClient } from "../api/client";

interface InvoiceLine {
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
}

export function ProjectCostAccountDetailPage() {
  const { id, accountId } = useParams<{ id: string; accountId: string }>();
  const [lines, setLines] = useState<InvoiceLine[] | null>(null);

  useEffect(() => {
    if (!id || !accountId) return;
    apiClient
      .get<InvoiceLine[]>(`/projects/${id}/costs/accounts/${accountId}/invoice-lines`)
      .then((res) => setLines(res.data));
  }, [id, accountId]);

  if (!lines) return <p style={{ padding: 24 }}>Loading…</p>;

  const totalNet = lines.reduce((sum, l) => sum + Number(l.netAmount), 0);
  const totalGross = lines.reduce((sum, l) => sum + Number(l.grossAmount), 0);

  return (
    <div className="card">
      <p>
        <Link to={`/projects/${id}`}>← Back to project</Link>
      </p>
      <h2>Recorded purchase invoice lines</h2>
      <div className="form-row">
        <div className="kpi-tile">
          <div>Net</div>
          <strong>{totalNet.toFixed(2)}</strong>
        </div>
        <div className="kpi-tile">
          <div>Gross</div>
          <strong>{totalGross.toFixed(2)}</strong>
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
            </tr>
          ))}
          {lines.length === 0 && (
            <tr>
              <td colSpan={8} style={{ color: "#98a2b3" }}>
                No invoice lines recorded yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
