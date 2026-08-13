import { FormEvent, useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiClient } from "../api/client";

interface Line {
  id: string;
  description: string;
  quantity: string;
  estimatedUnitPrice: string | null;
}

interface QuotationLine {
  quantity: string;
  unitPrice: string;
}

interface SiblingQuotation {
  id: string;
  quotationNumber: string | null;
  status: string;
  businessPartner: { code: string; name: string };
  lines: QuotationLine[];
}

interface RequisitionDetail {
  id: string;
  requisitionNumber: string | null;
  status: string;
  memo: string | null;
  requiredByDate: string | null;
  rejectionReason: string | null;
  project: { code: string; name: string } | null;
  lines: Line[];
  quotations: SiblingQuotation[];
}

interface Partner {
  id: string;
  code: string;
  name: string;
  partnerType: string;
}

function money(v: string | number): string {
  return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function quoteTotal(q: SiblingQuotation): number {
  return q.lines.reduce((sum, l) => sum + Number(l.quantity) * Number(l.unitPrice), 0);
}

export function PurchaseRequisitionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [req, setReq] = useState<RequisitionDetail | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [rfqForm, setRfqForm] = useState({
    businessPartnerId: "",
    quotationDate: new Date().toISOString().slice(0, 10),
    validUntil: "",
  });

  const load = useCallback(async () => {
    const res = await apiClient.get<RequisitionDetail>(`/procurement/requisitions/${id}`);
    setReq(res.data);
  }, [id]);

  useEffect(() => {
    load();
    apiClient.get<Partner[]>("/partners").then((res) => setPartners(res.data.filter((p) => ["VENDOR", "BOTH"].includes(p.partnerType))));
  }, [load]);

  async function action(path: string, body?: any) {
    setError(null);
    setBusy(true);
    try {
      await apiClient.post(`/procurement/requisitions/${id}/${path}`, body);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? `${path} failed`);
    } finally {
      setBusy(false);
    }
  }

  async function submitReject(e: FormEvent) {
    e.preventDefault();
    await action("reject", { reason: rejectReason });
    setShowReject(false);
    setRejectReason("");
  }

  async function sendRfq(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiClient.post(`/procurement/requisitions/${id}/send-rfq`, {
        businessPartnerId: rfqForm.businessPartnerId,
        quotationDate: new Date(rfqForm.quotationDate).toISOString(),
        validUntil: rfqForm.validUntil ? new Date(rfqForm.validUntil).toISOString() : undefined,
      });
      setRfqForm({ businessPartnerId: "", quotationDate: new Date().toISOString().slice(0, 10), validUntil: "" });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to send RFQ");
    } finally {
      setBusy(false);
    }
  }

  async function convertToPo(quotationId: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await apiClient.post<{ id: string }>(`/ap/orders/from-quotation/${quotationId}`);
      navigate(`/ap/orders/${res.data.id}`);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to convert to purchase order");
      setBusy(false);
    }
  }

  if (!req) return <p>Loading…</p>;

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>
            Requisition {req.requisitionNumber ?? "(draft)"}{" "}
            <span
              className={`badge ${
                req.status === "APPROVED" || req.status === "CLOSED"
                  ? "posted"
                  : req.status === "REJECTED" || req.status === "CANCELLED"
                    ? "reversed"
                    : "draft"
              }`}
            >
              {req.status}
            </span>
          </h2>
          <span>
            {req.status === "DRAFT" && (
              <button disabled={busy} onClick={() => action("submit")}>
                Submit for approval
              </button>
            )}
            {req.status === "PENDING_APPROVAL" && (
              <>
                <button disabled={busy} onClick={() => action("approve")}>
                  Approve
                </button>{" "}
                <button className="secondary" disabled={busy} onClick={() => setShowReject((s) => !s)}>
                  Reject
                </button>
              </>
            )}
            {(req.status === "DRAFT" || req.status === "PENDING_APPROVAL" || req.status === "APPROVED") && (
              <>
                {" "}
                <button className="secondary" disabled={busy} onClick={() => action("cancel")}>
                  Cancel
                </button>
              </>
            )}
          </span>
        </div>
        {error && <div className="error-banner">{error}</div>}
        {req.rejectionReason && <p style={{ color: "#b42318" }}>Rejected: {req.rejectionReason}</p>}
        <p style={{ color: "#667085", fontSize: 13 }}>
          {req.project ? `Project ${req.project.code} — ${req.project.name}` : "No project"}
          {req.requiredByDate ? ` · Required by ${new Date(req.requiredByDate).toLocaleDateString()}` : ""}
          {req.memo ? ` · ${req.memo}` : ""}
        </p>

        {showReject && (
          <form onSubmit={submitReject} className="form-row">
            <input placeholder="Rejection reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} required style={{ flex: 1 }} />
            <button type="submit" disabled={busy}>
              Confirm reject
            </button>
          </form>
        )}

        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th>Qty</th>
              <th>Est. unit price</th>
              <th>Est. total</th>
            </tr>
          </thead>
          <tbody>
            {req.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.description}</td>
                <td>{l.quantity}</td>
                <td>{l.estimatedUnitPrice ? money(l.estimatedUnitPrice) : "—"}</td>
                <td>{money(Number(l.quantity) * Number(l.estimatedUnitPrice ?? 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {req.status === "APPROVED" && (
        <div className="card">
          <h3>Send RFQ to vendor</h3>
          <p style={{ color: "#667085", fontSize: 13 }}>
            Send this requisition's lines as a price quote request to a vendor. Repeat for multiple vendors to compare.
          </p>
          <form onSubmit={sendRfq} className="form-row">
            <select value={rfqForm.businessPartnerId} onChange={(e) => setRfqForm({ ...rfqForm, businessPartnerId: e.target.value })} required style={{ flex: 1 }}>
              <option value="" disabled>
                Select vendor…
              </option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
            <div>
              <label>Date </label>
              <input type="date" value={rfqForm.quotationDate} onChange={(e) => setRfqForm({ ...rfqForm, quotationDate: e.target.value })} required />
            </div>
            <div>
              <label>Valid until </label>
              <input type="date" value={rfqForm.validUntil} onChange={(e) => setRfqForm({ ...rfqForm, validUntil: e.target.value })} />
            </div>
            <button type="submit" disabled={busy}>
              Send RFQ
            </button>
          </form>
        </div>
      )}

      {req.quotations.length > 0 && (
        <div className="card">
          <h3>Vendor quotations</h3>
          <table>
            <thead>
              <tr>
                <th>Number</th>
                <th>Vendor</th>
                <th>Total</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {req.quotations.map((q) => (
                <tr key={q.id}>
                  <td>{q.quotationNumber ?? "—"}</td>
                  <td>
                    {q.businessPartner.code} — {q.businessPartner.name}
                  </td>
                  <td>{money(quoteTotal(q))}</td>
                  <td>
                    <span
                      className={`badge ${
                        q.status === "CONVERTED" ? "posted" : q.status === "NOT_SELECTED" || q.status === "CANCELLED" ? "reversed" : "draft"
                      }`}
                    >
                      {q.status}
                    </span>
                  </td>
                  <td>
                    {(q.status === "DRAFT" || q.status === "RECEIVED") && (
                      <button disabled={busy} onClick={() => convertToPo(q.id)}>
                        Select &amp; convert to PO
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
