import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../api/client";
import { AttachButton } from "./AttachButton";
import { SearchableSelect } from "./SearchableSelect";

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
  isInventoryItem?: boolean;
}

interface Account {
  id: string;
  code: string;
  name: string;
  isPostable: boolean;
}

interface Warehouse {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
}

interface ProjectRef {
  id: string;
  code: string;
  name: string;
  status: string;
}

interface TaskRef {
  id: string;
  code: string;
  name: string;
}

type TaxMode = "EXCLUSIVE" | "INCLUSIVE";

interface LineForm {
  itemId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  vatCategory: "STANDARD_15" | "ZERO_RATED" | "EXEMPT";
  taxMode: TaxMode;
  accountId: string;
  warehouseId: string;
  projectId: string;
  wbsTaskId: string;
  attachmentFile: File | null;
}

const VAT_RATE: Record<string, number> = { STANDARD_15: 15, ZERO_RATED: 0, EXEMPT: 0 };

// Purchase invoice amounts are entered as what the vendor actually charged
// (VAT-inclusive) — default AP drafts to inclusive so VAT is backed out of
// the typed total rather than added on top. Sales quotes are typically net,
// so AR keeps the exclusive default.
function emptyLine(side: "ar" | "ap"): LineForm {
  return {
    itemId: "",
    description: "",
    quantity: "1",
    unitPrice: "0",
    discountAmount: "0",
    vatCategory: "STANDARD_15",
    taxMode: side === "ap" ? "INCLUSIVE" : "EXCLUSIVE",
    accountId: "",
    warehouseId: "",
    projectId: "",
    wbsTaskId: "",
    attachmentFile: null,
  };
}

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

export function InvoiceForm({ side }: { side: "ar" | "ap" }) {
  const navigate = useNavigate();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [partnerId, setPartnerId] = useState("");
  const [vendorInvoiceNumber, setVendorInvoiceNumber] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const [postingDate, setPostingDate] = useState(today);
  const [dueDate, setDueDate] = useState(new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10));
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<LineForm[]>([emptyLine(side)]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [tasksByProject, setTasksByProject] = useState<Record<string, TaskRef[]>>({});
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    apiClient.get<Partner[]>("/partners").then((res) => {
      const wanted = side === "ar" ? ["CUSTOMER", "BOTH"] : ["VENDOR", "BOTH"];
      setPartners(res.data.filter((p) => wanted.includes(p.partnerType)));
    });
    apiClient.get<Item[]>("/items").then((res) => setItems(res.data));
    apiClient.get<Warehouse[]>("/warehouses").then((res) => setWarehouses(res.data));
    apiClient.get<ProjectRef[]>("/projects").then((res) => {
      // Costs need ACTIVE; billing allows ACTIVE/COMPLETED
      const allowed = side === "ap" ? ["ACTIVE"] : ["ACTIVE", "COMPLETED"];
      setProjects(res.data.filter((p) => allowed.includes(p.status)));
    });
    if (side === "ap") {
      apiClient.get<Account[]>("/coa/accounts").then((res) => setAccounts(res.data.filter((a) => a.isPostable)));
    }
  }, [side]);

  async function loadTasks(projectId: string) {
    if (!projectId || tasksByProject[projectId]) return;
    const res = await apiClient.get(`/projects/${projectId}`);
    setTasksByProject((prev) => ({ ...prev, [projectId]: res.data.tasks.filter((t: any) => t.isActive) }));
  }

  const totals = useMemo(() => {
    return lines.reduce(
      (acc, line) => {
        const amounts = lineAmounts(line);
        return { net: acc.net + amounts.net, vat: acc.vat + amounts.vat, gross: acc.gross + amounts.gross };
      },
      { net: 0, vat: 0, gross: 0 },
    );
  }, [lines]);

  function updateLine(index: number, patch: Partial<LineForm>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function selectItem(index: number, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    const defaultWarehouse = warehouses.find((w) => w.isDefault);
    updateLine(index, {
      itemId,
      description: item ? item.name : "",
      vatCategory: item?.vatCategory ?? "STANDARD_15",
      warehouseId: item?.isInventoryItem ? defaultWarehouse?.id ?? "" : "",
    });
  }

  function isInventoryLine(line: LineForm): boolean {
    return !!items.find((i) => i.id === line.itemId)?.isInventoryItem;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        businessPartnerId: partnerId,
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
          accountId: line.accountId || undefined,
          warehouseId: line.warehouseId || undefined,
          projectId: line.projectId || undefined,
          wbsTaskId: line.wbsTaskId || undefined,
        })),
      };
      if (side === "ar") {
        payload.issueDateTime = new Date(postingDate).toISOString();
      } else {
        payload.vendorInvoiceNumber = vendorInvoiceNumber;
      }
      const created = await apiClient.post(`/${side}/invoices`, payload);
      // Once the invoice itself is created, a failed attachment upload
      // shouldn't block navigation or be reported as "invoice creation
      // failed" — the invoice is real; only the evidence needs a retry
      // (from the Purchase Invoices tab, where Attach is always available).
      if (side === "ap") {
        const createdLines: Array<{ id: string; lineNumber: number }> = created.data.lines ?? [];
        const uploads = lines
          .map((line, i) => ({ file: line.attachmentFile, lineNumber: i + 1 }))
          .filter((l): l is { file: File; lineNumber: number } => l.file !== null)
          .map(({ file, lineNumber }) => {
            const createdLine = createdLines.find((l) => l.lineNumber === lineNumber);
            if (!createdLine) return Promise.resolve();
            const form = new FormData();
            form.append("file", file);
            return apiClient.post(`/ap/invoices/lines/${createdLine.id}/attachment`, form, {
              headers: { "Content-Type": "multipart/form-data" },
            });
          });
        const results = await Promise.allSettled(uploads);
        const failures = results.filter((r) => r.status === "rejected").length;
        if (failures > 0) {
          setError(
            `Invoice saved, but ${failures} attachment${failures > 1 ? "s" : ""} failed to upload (file may be too large or an unsupported type) — attach ${failures > 1 ? "them" : "it"} again from the Purchase Invoices tab.`,
          );
          setSubmitting(false);
          return;
        }
      }
      navigate(`/${side}/invoices`);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create invoice");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <h2>{side === "ar" ? "New Sales Invoice" : "New Purchase Invoice"}</h2>
      {error && <div className="error-banner">{Array.isArray(error) ? (error as string[]).join("; ") : error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <div style={{ flex: 1 }}>
            <SearchableSelect
              options={partners}
              value={partnerId}
              onChange={setPartnerId}
              placeholder={`Search ${side === "ar" ? "customer" : "vendor"} by code or name…`}
              required
            />
          </div>
          {side === "ap" && (
            <input
              placeholder="Vendor invoice number"
              value={vendorInvoiceNumber}
              onChange={(e) => setVendorInvoiceNumber(e.target.value)}
              required
            />
          )}
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
              <th>Item</th>
              {side === "ap" && <th>Account</th>}
              <th>Description</th>
              <th>Qty</th>
              <th>Unit Price</th>
              <th>Discount</th>
              <th>VAT</th>
              {side === "ap" && <th>VAT mode</th>}
              <th>WH</th>
              <th>Project</th>
              <th>Task</th>
              <th>Net</th>
              <th>VAT Amt</th>
              {side === "ap" && <th>Evidence</th>}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const amounts = lineAmounts(line);
              return (
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
                  {side === "ap" && (
                    <td>
                      <SearchableSelect
                        options={accounts}
                        value={line.accountId}
                        onChange={(accountId) => updateLine(index, { accountId })}
                        placeholder={line.itemId ? "(default from item)" : "Search account…"}
                        required={!line.itemId}
                      />
                    </td>
                  )}
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
                    <input type="number" min="0" step="0.01" style={{ width: 80 }} value={line.discountAmount} onChange={(e) => updateLine(index, { discountAmount: e.target.value })} />
                  </td>
                  <td>
                    <select value={line.vatCategory} onChange={(e) => updateLine(index, { vatCategory: e.target.value as LineForm["vatCategory"] })}>
                      <option value="STANDARD_15">15%</option>
                      <option value="ZERO_RATED">0% (zero-rated)</option>
                      <option value="EXEMPT">Exempt</option>
                    </select>
                  </td>
                  {side === "ap" && (
                    <td>
                      <select value={line.taxMode} onChange={(e) => updateLine(index, { taxMode: e.target.value as TaxMode })}>
                        <option value="INCLUSIVE">Inclusive</option>
                        <option value="EXCLUSIVE">Exclusive</option>
                      </select>
                    </td>
                  )}
                  <td>
                    {isInventoryLine(line) ? (
                      <select
                        value={line.warehouseId}
                        onChange={(e) => updateLine(index, { warehouseId: e.target.value })}
                        required
                      >
                        <option value="" disabled>
                          WH…
                        </option>
                        {warehouses.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.code}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span style={{ color: "#98a2b3" }}>—</span>
                    )}
                  </td>
                  <td>
                    <select
                      value={line.projectId}
                      onChange={(e) => {
                        updateLine(index, { projectId: e.target.value, wbsTaskId: "" });
                        loadTasks(e.target.value);
                      }}
                    >
                      <option value="">—</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {line.projectId ? (
                      <select value={line.wbsTaskId} onChange={(e) => updateLine(index, { wbsTaskId: e.target.value })}>
                        <option value="">—</option>
                        {(tasksByProject[line.projectId] ?? []).map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.code}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span style={{ color: "#98a2b3" }}>—</span>
                    )}
                  </td>
                  <td>{amounts.net.toFixed(2)}</td>
                  <td>{amounts.vat.toFixed(2)}</td>
                  {side === "ap" && (
                    <td>
                      <AttachButton
                        uploading={false}
                        label={line.attachmentFile ? line.attachmentFile.name.slice(0, 14) : "Attach"}
                        onFile={(file) => updateLine(index, { attachmentFile: file })}
                      />
                    </td>
                  )}
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
          <button type="button" className="secondary" onClick={() => setLines((prev) => [...prev, emptyLine(side)])}>
            Add line
          </button>
          <strong>
            Net {totals.net.toFixed(2)} + VAT {totals.vat.toFixed(2)} = Gross {totals.gross.toFixed(2)}
          </strong>
        </div>

        <button type="submit" disabled={submitting || !partnerId} style={{ marginTop: 12 }}>
          {submitting ? "Saving…" : "Save as draft"}
        </button>
      </form>
    </div>
  );
}
