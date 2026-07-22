import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiClient } from "../api/client";

interface Partner {
  id: string;
  code: string;
  name: string;
  partnerType: "CUSTOMER" | "VENDOR" | "BOTH";
}

interface Item {
  id: string;
  code: string;
  name: string;
  vatCategory: "STANDARD_15" | "ZERO_RATED" | "EXEMPT";
}

interface QuotationLine {
  itemId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  vatCategory: string;
}

interface Quotation {
  id: string;
  quotationNumber: string | null;
  status: string;
  quotationDate: string;
  validUntil: string | null;
  businessPartner: { code: string; name: string };
  lines: Array<{ quantity: string; unitPrice: string }>;
}

function emptyLine(): QuotationLine {
  return { itemId: "", description: "", quantity: "1", unitPrice: "0", vatCategory: "STANDARD_15" };
}

function money(v: string | number): string {
  return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function lineTotal(line: { quantity: string; unitPrice: string }): number {
  return (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);
}

export function PurchaseQuotationsPage() {
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [partnerId, setPartnerId] = useState("");
  const [quotationDate, setQuotationDate] = useState(new Date().toISOString().slice(0, 10));
  const [validUntil, setValidUntil] = useState("");
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<QuotationLine[]>([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    return apiClient
      .get<Quotation[]>("/ap/quotations")
      .then((res) => setQuotations(res.data))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    apiClient.get<Partner[]>("/partners").then((res) => setPartners(res.data.filter((p) => p.partnerType !== "CUSTOMER")));
    apiClient.get<Item[]>("/items").then((res) => setItems(res.data));
  }, [load]);

  function updateLine(index: number, patch: Partial<QuotationLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function selectItem(index: number, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    updateLine(index, { itemId, description: item ? item.name : "", vatCategory: item?.vatCategory ?? "STANDARD_15" });
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.post("/ap/quotations", {
        businessPartnerId: partnerId,
        quotationDate: new Date(quotationDate).toISOString(),
        validUntil: validUntil ? new Date(validUntil).toISOString() : undefined,
        memo: memo || undefined,
        lines: lines.map((l) => ({
          itemId: l.itemId || undefined,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          vatCategory: l.vatCategory,
        })),
      });
      setPartnerId("");
      setValidUntil("");
      setMemo("");
      setLines([emptyLine()]);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create quotation");
    } finally {
      setSubmitting(false);
    }
  }

  async function convertToPo(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await apiClient.post(`/ap/orders/from-quotation/${id}`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to convert to purchase order");
    } finally {
      setBusyId(null);
    }
  }

  async function cancelQuotation(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await apiClient.post(`/ap/quotations/${id}/cancel`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to cancel quotation");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>Purchase Quotations</h2>
        {error && <div className="error-banner">{error}</div>}
        {loading ? (
          <p>Loading…</p>
        ) : quotations.length === 0 ? (
          <p>No quotations yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Number</th>
                <th>Vendor</th>
                <th>Date</th>
                <th>Valid until</th>
                <th>Estimated total</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {quotations.map((q) => (
                <tr key={q.id}>
                  <td>{q.quotationNumber ?? "—"}</td>
                  <td>{q.businessPartner.code} — {q.businessPartner.name}</td>
                  <td>{new Date(q.quotationDate).toLocaleDateString()}</td>
                  <td>{q.validUntil ? new Date(q.validUntil).toLocaleDateString() : "—"}</td>
                  <td>{money(q.lines.reduce((sum, l) => sum + lineTotal(l), 0))}</td>
                  <td>
                    <span className={`badge ${q.status === "CONVERTED" ? "posted" : q.status === "CANCELLED" ? "reversed" : "draft"}`}>
                      {q.status}
                    </span>
                  </td>
                  <td>
                    {(q.status === "DRAFT" || q.status === "RECEIVED") && (
                      <>
                        <button className="secondary" disabled={busyId === q.id} onClick={() => convertToPo(q.id)}>
                          Convert to PO
                        </button>{" "}
                        <button className="secondary" disabled={busyId === q.id} onClick={() => cancelQuotation(q.id)}>
                          Cancel
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>New quotation</h3>
        <form onSubmit={handleCreate}>
          <div className="form-row">
            <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)} required style={{ flex: 1 }}>
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
              <input type="date" value={quotationDate} onChange={(e) => setQuotationDate(e.target.value)} required />
            </div>
            <div>
              <label>Valid until </label>
              <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <input placeholder="Memo (optional)" value={memo} onChange={(e) => setMemo(e.target.value)} style={{ flex: 1 }} />
          </div>

          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Description</th>
                <th>Qty</th>
                <th>Unit price</th>
                <th>VAT</th>
                <th>Line total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={index}>
                  <td>
                    <select value={line.itemId} onChange={(e) => selectItem(index, e.target.value)}>
                      <option value="">(no item)</option>
                      {items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.code} — {item.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input value={line.description} onChange={(e) => updateLine(index, { description: e.target.value })} required />
                  </td>
                  <td>
                    <input type="number" min="0.000001" step="any" style={{ width: 70 }} value={line.quantity} onChange={(e) => updateLine(index, { quantity: e.target.value })} />
                  </td>
                  <td>
                    <input type="number" min="0" step="0.01" style={{ width: 90 }} value={line.unitPrice} onChange={(e) => updateLine(index, { unitPrice: e.target.value })} />
                  </td>
                  <td>
                    <select value={line.vatCategory} onChange={(e) => updateLine(index, { vatCategory: e.target.value })}>
                      <option value="STANDARD_15">15%</option>
                      <option value="ZERO_RATED">0% (zero-rated)</option>
                      <option value="EXEMPT">Exempt</option>
                    </select>
                  </td>
                  <td>{money(lineTotal(line))}</td>
                  <td>
                    {lines.length > 1 && (
                      <button type="button" className="secondary" onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}>
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="form-row" style={{ justifyContent: "space-between", marginTop: 10 }}>
            <button type="button" className="secondary" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
              Add line
            </button>
            <strong>Estimated total: {money(lines.reduce((sum, l) => sum + lineTotal(l), 0))}</strong>
          </div>

          <button type="submit" disabled={submitting || !partnerId} style={{ marginTop: 12 }}>
            {submitting ? "Saving…" : "Create quotation"}
          </button>
        </form>
      </div>
    </div>
  );
}
