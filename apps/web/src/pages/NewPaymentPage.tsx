import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiClient } from "../api/client";

interface Partner {
  id: string;
  code: string;
  name: string;
  partnerType: string;
}

interface Account {
  id: string;
  code: string;
  name: string;
  controlAccountType: string | null;
}

interface OpenInvoice {
  id: string;
  invoiceNumber: string | null;
  dueDate: string;
  grossTotal: string;
  openAmount: string;
}

export function NewPaymentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const direction = searchParams.get("direction") === "OUTGOING" ? "OUTGOING" : "INCOMING";

  const [partners, setPartners] = useState<Partner[]>([]);
  const [bankAccounts, setBankAccounts] = useState<Account[]>([]);
  const [openInvoices, setOpenInvoices] = useState<OpenInvoice[]>([]);
  const [partnerId, setPartnerId] = useState("");
  const [bankCashAccountId, setBankCashAccountId] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("0");
  const [reference, setReference] = useState("");
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiClient.get<Partner[]>("/partners").then((res) => {
      const wanted = direction === "INCOMING" ? ["CUSTOMER", "BOTH"] : ["VENDOR", "BOTH"];
      setPartners(res.data.filter((p) => wanted.includes(p.partnerType)));
    });
    apiClient.get<Account[]>("/coa/accounts").then((res) => {
      setBankAccounts(res.data.filter((a) => a.controlAccountType === "BANK" || a.controlAccountType === "CASH"));
    });
  }, [direction]);

  const loadOpenInvoices = useCallback(
    (pid: string) => {
      if (!pid) {
        setOpenInvoices([]);
        return;
      }
      const base = direction === "INCOMING" ? "/ar/invoices/open" : "/ap/invoices/open";
      apiClient.get<OpenInvoice[]>(base, { params: { partnerId: pid } }).then((res) => setOpenInvoices(res.data));
    },
    [direction],
  );

  useEffect(() => {
    loadOpenInvoices(partnerId);
    setAllocations({});
  }, [partnerId, loadOpenInvoices]);

  const totalAllocated = useMemo(
    () => Object.values(allocations).reduce((sum, v) => sum + (Number(v) || 0), 0),
    [allocations],
  );
  const remainder = (Number(amount) || 0) - totalAllocated;

  function autoAllocate() {
    let remaining = Number(amount) || 0;
    const next: Record<string, string> = {};
    // Oldest due date first
    for (const invoice of [...openInvoices].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, Number(invoice.openAmount));
      if (take > 0) {
        next[invoice.id] = take.toFixed(2);
        remaining -= take;
      }
    }
    setAllocations(next);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.post(direction === "INCOMING" ? "/payments/incoming" : "/payments/outgoing", {
        businessPartnerId: partnerId,
        paymentDate: new Date(paymentDate).toISOString(),
        bankCashAccountId,
        amount,
        reference: reference || undefined,
        allocations: Object.entries(allocations)
          .filter(([, v]) => Number(v) > 0)
          .map(([invoiceId, v]) => ({ invoiceId, amount: v })),
      });
      navigate("/payments");
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create payment");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <h2>{direction === "INCOMING" ? "Receive Payment" : "Pay Vendor"}</h2>
      {error && <div className="error-banner">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)} required style={{ flex: 1 }}>
            <option value="" disabled>
              Select {direction === "INCOMING" ? "customer" : "vendor"}…
            </option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
          <select value={bankCashAccountId} onChange={(e) => setBankCashAccountId(e.target.value)} required>
            <option value="" disabled>
              Bank/cash account…
            </option>
            {bankAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
          <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} required />
          <input
            type="number"
            min="0.01"
            step="0.01"
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            style={{ width: 120 }}
          />
          <input placeholder="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>

        <h3>Allocate against open invoices</h3>
        {openInvoices.length === 0 ? (
          <p>{partnerId ? "No open invoices — the full amount will be held on account." : "Select a partner first."}</p>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Due</th>
                  <th>Gross</th>
                  <th>Open</th>
                  <th>Allocate</th>
                </tr>
              </thead>
              <tbody>
                {openInvoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>{invoice.invoiceNumber}</td>
                    <td>{new Date(invoice.dueDate).toLocaleDateString()}</td>
                    <td>{Number(invoice.grossTotal).toFixed(2)}</td>
                    <td>{Number(invoice.openAmount).toFixed(2)}</td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        max={invoice.openAmount}
                        style={{ width: 110 }}
                        value={allocations[invoice.id] ?? ""}
                        onChange={(e) => setAllocations((prev) => ({ ...prev, [invoice.id]: e.target.value }))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="form-row" style={{ justifyContent: "space-between", marginTop: 8 }}>
              <button type="button" className="secondary" onClick={autoAllocate}>
                Auto-allocate (oldest first)
              </button>
              <span className={remainder < 0 ? "balance-bad" : "balance-ok"}>
                Allocated {totalAllocated.toFixed(2)} / {Number(amount || 0).toFixed(2)}
                {remainder > 0 && ` — ${remainder.toFixed(2)} on account`}
                {remainder < 0 && " — over-allocated!"}
              </span>
            </div>
          </>
        )}

        <button type="submit" disabled={submitting || !partnerId || !bankCashAccountId || remainder < 0} style={{ marginTop: 12 }}>
          {submitting ? "Posting…" : "Post payment"}
        </button>
      </form>
    </div>
  );
}
