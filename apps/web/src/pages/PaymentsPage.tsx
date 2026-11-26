import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../api/client";
import { useCanDownload } from "../hooks/useCanDownload";
import { useDocumentPdfDownload } from "../hooks/useDocumentPdfDownload";
import { amountInWords } from "../utils/amountInWords";

interface PaymentRow {
  id: string;
  paymentNumber: string | null;
  direction: "INCOMING" | "OUTGOING";
  paymentDate: string;
  amount: string;
  allocatedAmount: string;
  unallocatedAmount: string;
  reference: string | null;
  status: "POSTED" | "CANCELLED";
  businessPartner?: { code: string; name: string };
  bankCashAccount?: { code: string; name: string };
}

interface PaymentDetail extends PaymentRow {
  memo: string | null;
  currencyCode: string;
  businessPartner: { code: string; name: string; taxRegistrationNumber?: string | null };
  allocations: Array<{ allocatedAmount: string; salesInvoice?: { invoiceNumber: string | null } | null; purchaseInvoice?: { invoiceNumber: string | null; vendorInvoiceNumber: string | null } | null }>;
}

export function PaymentsPage() {
  const canDownload = useCanDownload();
  const { download } = useDocumentPdfDownload("sales");
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [direction, setDirection] = useState<"ALL" | "INCOMING" | "OUTGOING">("ALL");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dateSort, setDateSort] = useState<"asc" | "desc">("desc");

  const load = useCallback(() => {
    setLoading(true);
    const params = direction !== "ALL" ? { direction } : {};
    return apiClient
      .get<PaymentRow[]>("/payments", { params })
      .then((res) => setPayments(res.data))
      .finally(() => setLoading(false));
  }, [direction]);

  useEffect(() => {
    load();
  }, [load]);

  async function downloadReceipt(id: string) {
    setError(null);
    setBusyId(id);
    try {
      const p = (await apiClient.get<PaymentDetail>(`/payments/${id}`)).data;
      const incoming = p.direction === "INCOMING";
      const total = Number(p.amount);
      const fmt = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const rows = p.allocations.map((a, i) => [
        String(i + 1),
        incoming ? `Invoice ${a.salesInvoice?.invoiceNumber ?? ""}` : `Invoice ${a.purchaseInvoice?.invoiceNumber ?? a.purchaseInvoice?.vendorInvoiceNumber ?? ""}`,
        fmt(Number(a.allocatedAmount)),
      ]);
      if (Number(p.unallocatedAmount) > 0) rows.push([String(rows.length + 1), "On account (not yet applied to an invoice)", fmt(Number(p.unallocatedAmount))]);
      rows.push(["", "TOTAL " + (incoming ? "RECEIVED" : "PAID") + (p.currencyCode ? ` (${p.currencyCode})` : ""), fmt(total)]);
      const refs: Array<[string, string]> = [["Paid into", p.bankCashAccount ? `${p.bankCashAccount.code} — ${p.bankCashAccount.name}` : ""], ["Amount in words", amountInWords(total, p.currencyCode)]];
      if (p.reference) refs.push(["Reference", p.reference]);
      download({
        docTypeLabel: incoming ? "Receipt Voucher" : "Payment Voucher",
        documentNumber: p.paymentNumber,
        documentDate: p.paymentDate,
        status: p.status,
        recordId: p.id,
        partnerLabel: incoming ? "Received from" : "Paid to",
        partner: p.businessPartner,
        references: refs,
        notes: p.memo,
        signatures: incoming ? ["Received by", "Authorised by", "Customer signature"] : ["Prepared by", "Authorised by", "Received by (payee)"],
        lines: [],
        plainTable: { head: ["#", "Settles", "Amount"], rightAlign: [2], body: rows },
      });
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to generate receipt");
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(id: string) {
    setError(null);
    setBusyId(id);
    try {
      await apiClient.post(`/payments/${id}/cancel`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to cancel payment");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Payments</h2>
        <span>
          <Link to="/payments/new?direction=INCOMING">
            <button>Receive payment</button>
          </Link>{" "}
          <Link to="/payments/new?direction=OUTGOING">
            <button className="secondary">Pay vendor</button>
          </Link>
        </span>
      </div>
      <div className="form-row">
        {(["ALL", "INCOMING", "OUTGOING"] as const).map((d) => (
          <button key={d} type="button" className={d === direction ? "" : "secondary"} onClick={() => setDirection(d)}>
            {d}
          </button>
        ))}
      </div>
      {error && <div className="error-banner">{error}</div>}
      {loading ? (
        <p>Loading…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Number</th>
              <th>Direction</th>
              <th>Partner</th>
              <th style={{ cursor: "pointer" }} onClick={() => setDateSort((d) => (d === "asc" ? "desc" : "asc"))}>
                Date {dateSort === "asc" ? "▲" : "▼"}
              </th>
              <th>Amount</th>
              <th>Allocated</th>
              <th>On Account</th>
              <th>Account</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {[...payments]
              .sort((a, b) => (dateSort === "asc" ? a.paymentDate.localeCompare(b.paymentDate) : b.paymentDate.localeCompare(a.paymentDate)))
              .map((p) => (
              <tr key={p.id}>
                <td>{p.paymentNumber}</td>
                <td>{p.direction}</td>
                <td>{p.businessPartner?.name}</td>
                <td>{new Date(p.paymentDate).toLocaleDateString()}</td>
                <td>{Number(p.amount).toFixed(2)}</td>
                <td>{Number(p.allocatedAmount).toFixed(2)}</td>
                <td>{Number(p.unallocatedAmount).toFixed(2)}</td>
                <td>{p.bankCashAccount ? `${p.bankCashAccount.code}` : ""}</td>
                <td>
                  <span className={`badge ${p.status === "POSTED" ? "posted" : "reversed"}`}>{p.status}</span>
                </td>
                <td>
                  {canDownload && (
                    <>
                      <button className="secondary" disabled={busyId === p.id} onClick={() => downloadReceipt(p.id)}>
                        {p.direction === "INCOMING" ? "Receipt" : "Voucher"}
                      </button>{" "}
                    </>
                  )}
                  {p.status === "POSTED" && (
                    <button className="secondary" disabled={busyId === p.id} onClick={() => cancel(p.id)}>
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
