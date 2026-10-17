import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiClient } from "../api/client";
import { SearchableSelect } from "../components/SearchableSelect";

interface Account {
  id: string;
  code: string;
  name: string;
  isPostable: boolean;
}

interface ProjectRef {
  id: string;
  code: string;
  name: string;
  status: string;
}

type VatCategory = "STANDARD_15" | "ZERO_RATED" | "EXEMPT";
type TaxMode = "EXCLUSIVE" | "INCLUSIVE";

interface LineForm {
  itemId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  vatCategory: VatCategory;
  taxMode: TaxMode;
  accountId: string;
  projectId: string;
}

interface InvoiceLine {
  itemId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  vatCategory: VatCategory;
  grossAmount: string;
  expenseAccountId: string;
  projectId: string | null;
}

interface VendorRef {
  id: string;
  code: string;
  name: string;
  partnerType: "CUSTOMER" | "VENDOR" | "BOTH";
}

interface InvoiceDetail {
  id: string;
  status: string;
  businessPartnerId: string;
  vendorInvoiceNumber: string;
  postingDate: string;
  dueDate: string;
  memo: string | null;
  businessPartner: { id: string; code: string; name: string };
  sourcePurchaseOrderId: string | null;
  lines: InvoiceLine[];
}

const VAT_RATE: Record<VatCategory, number> = { STANDARD_15: 15, ZERO_RATED: 0, EXEMPT: 0 };

function lineAmounts(line: LineForm) {
  const rawAmount = Math.max(0, (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0) - (Number(line.discountAmount) || 0));
  const rawRounded = Math.round(rawAmount * 100) / 100;
  const rate = VAT_RATE[line.vatCategory];
  if (line.taxMode === "INCLUSIVE") {
    const net = Math.round((rawRounded / (1 + rate / 100)) * 100) / 100;
    const vat = rawRounded - net;
    return { net, vat, gross: rawRounded };
  }
  const vat = Math.round((rawRounded * rate) / 100 * 100) / 100;
  return { net: rawRounded, vat, gross: rawRounded + vat };
}

export function EditPurchaseInvoicePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [vendors, setVendors] = useState<VendorRef[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [vendorInvoiceNumber, setVendorInvoiceNumber] = useState("");
  const [postingDate, setPostingDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<LineForm[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!id) return;
    apiClient.get<InvoiceDetail>(`/ap/invoices/${id}`).then((res) => {
      const inv = res.data;
      setInvoice(inv);
      setVendorId(inv.businessPartnerId);
      setVendorInvoiceNumber(inv.vendorInvoiceNumber);
      setPostingDate(inv.postingDate.slice(0, 10));
      setDueDate(inv.dueDate.slice(0, 10));
      setMemo(inv.memo ?? "");
      setLines(
        inv.lines.map((l) => ({
          itemId: l.itemId,
          description: l.description,
          // Amounts on this business's invoices are always VAT-inclusive —
          // show/edit the actual total charged (gross), not the net, so
          // reopening a line and saving without changes reproduces the same
          // gross exactly (the inclusive formula preserves the typed total).
          quantity: "1",
          unitPrice: l.grossAmount,
          discountAmount: "0",
          vatCategory: l.vatCategory,
          taxMode: "INCLUSIVE",
          accountId: l.expenseAccountId,
          projectId: l.projectId ?? "",
        })),
      );
    });
    apiClient
      .get<VendorRef[]>("/partners")
      .then((res) => setVendors(res.data.filter((p) => p.partnerType === "VENDOR" || p.partnerType === "BOTH")))
      .catch(() => setVendors([]));
    apiClient.get<Account[]>("/coa/accounts").then((res) => setAccounts(res.data.filter((a) => a.isPostable)));
    apiClient.get<ProjectRef[]>("/projects").then((res) => setProjects(res.data.filter((p) => p.status === "ACTIVE")));
  }, [id]);

  const totals = useMemo(
    () =>
      lines.reduce(
        (acc, line) => {
          const amounts = lineAmounts(line);
          return { net: acc.net + amounts.net, vat: acc.vat + amounts.vat, gross: acc.gross + amounts.gross };
        },
        { net: 0, vat: 0, gross: 0 },
      ),
    [lines],
  );

  // Keep the invoice's current vendor selectable even when it isn't in the
  // loaded list (e.g. it has since been deactivated).
  const vendorOptions = useMemo(() => {
    if (!invoice || vendors.some((v) => v.id === invoice.businessPartnerId)) return vendors;
    return [{ ...invoice.businessPartner, partnerType: "VENDOR" as const }, ...vendors];
  }, [vendors, invoice]);

  function updateLine(index: number, patch: Partial<LineForm>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.patch(`/ap/invoices/${id}`, {
        businessPartnerId: vendorId,
        vendorInvoiceNumber,
        postingDate: new Date(postingDate).toISOString(),
        dueDate: new Date(dueDate).toISOString(),
        memo: memo || undefined,
        lines: lines.map((line) => ({
          itemId: line.itemId || undefined,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountAmount: line.discountAmount || "0",
          vatCategory: line.vatCategory,
          taxMode: line.taxMode,
          accountId: line.accountId,
          projectId: line.projectId || undefined,
        })),
      });
      navigate("/ap/invoices");
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to update invoice");
    } finally {
      setSubmitting(false);
    }
  }

  if (!invoice) {
    return <div className="card">Loading…</div>;
  }

  if (invoice.status !== "DRAFT") {
    return (
      <div className="card">
        <h2>Edit Purchase Invoice</h2>
        <div className="error-banner">
          This invoice is {invoice.status} — only draft invoices can be edited. Posted invoices are immutable; use Cancel instead.
        </div>
      </div>
    );
  }

  const vendorLocked = !!invoice.sourcePurchaseOrderId;

  return (
    <div className="card invoice-edit">
      <div className="invoice-edit-header">
        <div>
          <h2 style={{ margin: 0 }}>Edit Purchase Invoice</h2>
          <p className="invoice-edit-sub">
            {invoice.businessPartner.code} · {invoice.businessPartner.name}
          </p>
        </div>
        <span className="badge draft">DRAFT</span>
      </div>
      {error && <div className="error-banner">{Array.isArray(error) ? (error as string[]).join("; ") : error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="invoice-edit-section">Invoice details</div>
        <div className="field-grid">
          <div className="field field-wide">
            <label>Vendor</label>
            <SearchableSelect
              options={vendorOptions}
              value={vendorId}
              onChange={setVendorId}
              placeholder="Search vendor by code or name…"
              required
              disabled={vendorLocked}
            />
            {vendorLocked && <span className="field-hint">Created from a purchase order, so the vendor cannot be changed.</span>}
          </div>
          <div className="field">
            <label>Vendor invoice no.</label>
            <input
              placeholder="e.g. INV-1042"
              value={vendorInvoiceNumber}
              onChange={(e) => setVendorInvoiceNumber(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label>Posting date</label>
            <input type="date" value={postingDate} onChange={(e) => setPostingDate(e.target.value)} required />
          </div>
          <div className="field">
            <label>Due date</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
          </div>
          <div className="field field-full">
            <label>Memo</label>
            <input placeholder="Optional note for this invoice" value={memo} onChange={(e) => setMemo(e.target.value)} />
          </div>
        </div>

        <div className="invoice-edit-section">Line items</div>
        <div className="invoice-lines-wrap">
          <table className="invoice-lines">
            <thead>
              <tr>
                <th style={{ minWidth: 200 }}>Description</th>
                <th className="num">Amount</th>
                <th style={{ minWidth: 220 }}>Account</th>
                <th>VAT</th>
                <th>VAT mode</th>
                <th>Project</th>
                <th className="num">Net</th>
                <th className="num">VAT</th>
                <th className="num">Gross</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const amounts = lineAmounts(line);
                return (
                  <tr key={index}>
                    <td>
                      <input
                        value={line.description}
                        placeholder="What was purchased"
                        onChange={(e) => updateLine(index, { description: e.target.value })}
                        required
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="num"
                        value={line.unitPrice}
                        onChange={(e) => updateLine(index, { unitPrice: e.target.value, quantity: "1", discountAmount: "0" })}
                      />
                    </td>
                    <td>
                      <SearchableSelect
                        options={accounts}
                        value={line.accountId}
                        onChange={(accountId) => updateLine(index, { accountId })}
                        placeholder="Search account…"
                        required
                      />
                    </td>
                    <td>
                      <select value={line.vatCategory} onChange={(e) => updateLine(index, { vatCategory: e.target.value as VatCategory })}>
                        <option value="STANDARD_15">15%</option>
                        <option value="ZERO_RATED">0% (zero-rated)</option>
                        <option value="EXEMPT">Exempt</option>
                      </select>
                    </td>
                    <td>
                      <select value={line.taxMode} onChange={(e) => updateLine(index, { taxMode: e.target.value as TaxMode })}>
                        <option value="EXCLUSIVE">Exclusive</option>
                        <option value="INCLUSIVE">Inclusive</option>
                      </select>
                    </td>
                    <td>
                      <select value={line.projectId} onChange={(e) => updateLine(index, { projectId: e.target.value })}>
                        <option value="">— None —</option>
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.code}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="num">{amounts.net.toFixed(2)}</td>
                    <td className="num">{amounts.vat.toFixed(2)}</td>
                    <td className="num">
                      <strong>{amounts.gross.toFixed(2)}</strong>
                    </td>
                    <td>
                      {lines.length > 1 && (
                        <button
                          type="button"
                          className="secondary"
                          title="Remove line"
                          onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="invoice-edit-footer">
          <button
            type="button"
            className="secondary"
            onClick={() =>
              setLines((prev) => [
                ...prev,
                { itemId: null, description: "", quantity: "1", unitPrice: "0", discountAmount: "0", vatCategory: "STANDARD_15", taxMode: "INCLUSIVE", accountId: "", projectId: "" },
              ])
            }
          >
            + Add line
          </button>
          <div className="invoice-totals">
            <div>
              <span>Net</span>
              <span>{totals.net.toFixed(2)}</span>
            </div>
            <div>
              <span>VAT</span>
              <span>{totals.vat.toFixed(2)}</span>
            </div>
            <div className="invoice-totals-gross">
              <span>Gross total</span>
              <span>{totals.gross.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="invoice-edit-actions">
          <button type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Save changes"}
          </button>
          <button type="button" className="secondary" onClick={() => navigate("/ap/invoices")}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
