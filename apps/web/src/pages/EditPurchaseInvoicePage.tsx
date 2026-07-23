import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiClient } from "../api/client";

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

interface InvoiceDetail {
  id: string;
  status: string;
  vendorInvoiceNumber: string;
  postingDate: string;
  dueDate: string;
  memo: string | null;
  businessPartner: { code: string; name: string };
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

  return (
    <div className="card">
      <h2>Edit Purchase Invoice — {invoice.businessPartner.code} {invoice.businessPartner.name}</h2>
      {error && <div className="error-banner">{Array.isArray(error) ? (error as string[]).join("; ") : error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <input
            placeholder="Vendor invoice number"
            value={vendorInvoiceNumber}
            onChange={(e) => setVendorInvoiceNumber(e.target.value)}
            required
          />
          <div>
            <label>Posting </label>
            <input type="date" value={postingDate} onChange={(e) => setPostingDate(e.target.value)} required />
          </div>
          <div>
            <label>Due </label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
          </div>
        </div>
        <div className="form-row">
          <input placeholder="Memo (optional)" value={memo} onChange={(e) => setMemo(e.target.value)} style={{ flex: 1 }} />
        </div>

        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th>Amount</th>
              <th>Account</th>
              <th>VAT</th>
              <th>VAT mode</th>
              <th>Project</th>
              <th>Net</th>
              <th>VAT Amt</th>
              <th>Gross</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const amounts = lineAmounts(line);
              return (
                <tr key={index}>
                  <td>
                    <input value={line.description} onChange={(e) => updateLine(index, { description: e.target.value })} required />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      style={{ width: 100 }}
                      value={line.unitPrice}
                      onChange={(e) => updateLine(index, { unitPrice: e.target.value, quantity: "1", discountAmount: "0" })}
                    />
                  </td>
                  <td>
                    <select value={line.accountId} onChange={(e) => updateLine(index, { accountId: e.target.value })} required>
                      <option value="" disabled>
                        Account…
                      </option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} — {a.name}
                        </option>
                      ))}
                    </select>
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
                      <option value="">—</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{amounts.net.toFixed(2)}</td>
                  <td>{amounts.vat.toFixed(2)}</td>
                  <td>{amounts.gross.toFixed(2)}</td>
                  <td>
                    {lines.length > 1 && (
                      <button type="button" className="secondary" onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}>
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="form-row" style={{ justifyContent: "space-between", marginTop: 10 }}>
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
            Add line
          </button>
          <strong>
            Net {totals.net.toFixed(2)} + VAT {totals.vat.toFixed(2)} = Gross {totals.gross.toFixed(2)}
          </strong>
        </div>

        <div className="form-row" style={{ marginTop: 12 }}>
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
