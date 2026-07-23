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
  isInventoryItem?: boolean;
}

interface Warehouse {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
}

interface CostCenter {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

interface OrderLine {
  itemId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  vatCategory: string;
  warehouseId: string;
  costCenterId: string;
}

interface PurchaseOrderLine {
  id: string;
  quantity: string;
  invoicedQuantity: string;
  unitPrice: string;
}

interface PurchaseOrder {
  id: string;
  orderNumber: string | null;
  status: string;
  orderDate: string;
  businessPartner: { code: string; name: string };
  lines: PurchaseOrderLine[];
}

function emptyLine(): OrderLine {
  return { itemId: "", description: "", quantity: "1", unitPrice: "0", vatCategory: "STANDARD_15", warehouseId: "", costCenterId: "" };
}

function money(v: string | number): string {
  return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function orderTotal(order: PurchaseOrder): number {
  return order.lines.reduce((sum, l) => sum + Number(l.quantity) * Number(l.unitPrice), 0);
}

function orderRemaining(order: PurchaseOrder): number {
  return order.lines.reduce((sum, l) => sum + (Number(l.quantity) - Number(l.invoicedQuantity)) * Number(l.unitPrice), 0);
}

export function PurchaseOrdersPage() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [invoiceFormId, setInvoiceFormId] = useState<string | null>(null);
  const [dateSort, setDateSort] = useState<"asc" | "desc">("desc");
  const [invoiceForm, setInvoiceForm] = useState({
    vendorInvoiceNumber: "",
    postingDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10),
  });

  const [partnerId, setPartnerId] = useState("");
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [expectedDate, setExpectedDate] = useState("");
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<OrderLine[]>([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    return apiClient
      .get<PurchaseOrder[]>("/ap/orders")
      .then((res) => setOrders(res.data))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    apiClient.get<Partner[]>("/partners").then((res) => setPartners(res.data.filter((p) => p.partnerType !== "CUSTOMER")));
    apiClient.get<Item[]>("/items").then((res) => setItems(res.data));
    apiClient.get<Warehouse[]>("/warehouses").then((res) => setWarehouses(res.data));
    apiClient.get<CostCenter[]>("/cost-centers").then((res) => setCostCenters(res.data.filter((c) => c.isActive)));
  }, [load]);

  function updateLine(index: number, patch: Partial<OrderLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
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

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.post("/ap/orders", {
        businessPartnerId: partnerId,
        orderDate: new Date(orderDate).toISOString(),
        expectedDate: expectedDate ? new Date(expectedDate).toISOString() : undefined,
        memo: memo || undefined,
        lines: lines.map((l) => ({
          itemId: l.itemId || undefined,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          vatCategory: l.vatCategory,
          warehouseId: l.warehouseId || undefined,
          costCenterId: l.costCenterId || undefined,
        })),
      });
      setPartnerId("");
      setExpectedDate("");
      setMemo("");
      setLines([emptyLine()]);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create purchase order");
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelOrder(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await apiClient.post(`/ap/orders/${id}/cancel`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to cancel purchase order");
    } finally {
      setBusyId(null);
    }
  }

  async function submitGenerateInvoice(e: FormEvent, orderId: string) {
    e.preventDefault();
    setBusyId(orderId);
    setError(null);
    try {
      await apiClient.post(`/ap/orders/${orderId}/generate-invoice`, {
        vendorInvoiceNumber: invoiceForm.vendorInvoiceNumber,
        postingDate: new Date(invoiceForm.postingDate).toISOString(),
        dueDate: new Date(invoiceForm.dueDate).toISOString(),
      });
      setInvoiceFormId(null);
      setInvoiceForm({ vendorInvoiceNumber: "", postingDate: new Date().toISOString().slice(0, 10), dueDate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10) });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to generate invoice");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>Purchase Orders</h2>
        {error && <div className="error-banner">{error}</div>}
        {loading ? (
          <p>Loading…</p>
        ) : orders.length === 0 ? (
          <p>No purchase orders yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Number</th>
                <th>Vendor</th>
                <th style={{ cursor: "pointer" }} onClick={() => setDateSort((d) => (d === "asc" ? "desc" : "asc"))}>
                  Date {dateSort === "asc" ? "▲" : "▼"}
                </th>
                <th>Total</th>
                <th>Remaining to invoice</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {[...orders]
                .sort((a, b) => (dateSort === "asc" ? a.orderDate.localeCompare(b.orderDate) : b.orderDate.localeCompare(a.orderDate)))
                .map((o) => (
                <>
                  <tr key={o.id}>
                    <td>{o.orderNumber ?? "—"}</td>
                    <td>{o.businessPartner.code} — {o.businessPartner.name}</td>
                    <td>{new Date(o.orderDate).toLocaleDateString()}</td>
                    <td>{money(orderTotal(o))}</td>
                    <td>{money(orderRemaining(o))}</td>
                    <td>
                      <span className={`badge ${o.status === "INVOICED" ? "posted" : o.status === "CANCELLED" ? "reversed" : "draft"}`}>
                        {o.status}
                      </span>
                    </td>
                    <td>
                      {(o.status === "SENT" || o.status === "PARTIALLY_INVOICED") && (
                        <>
                          <button className="secondary" disabled={busyId === o.id} onClick={() => setInvoiceFormId(invoiceFormId === o.id ? null : o.id)}>
                            Generate Invoice
                          </button>{" "}
                          <button className="secondary" disabled={busyId === o.id} onClick={() => cancelOrder(o.id)}>
                            Cancel
                          </button>
                        </>
                      )}
                      {o.status === "DRAFT" && (
                        <button className="secondary" disabled={busyId === o.id} onClick={() => cancelOrder(o.id)}>
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                  {invoiceFormId === o.id && (
                    <tr>
                      <td colSpan={7}>
                        <form onSubmit={(e) => submitGenerateInvoice(e, o.id)} className="form-row">
                          <input
                            placeholder="Vendor invoice number"
                            value={invoiceForm.vendorInvoiceNumber}
                            onChange={(e) => setInvoiceForm({ ...invoiceForm, vendorInvoiceNumber: e.target.value })}
                            required
                          />
                          <div>
                            <label>Posting </label>
                            <input
                              type="date"
                              value={invoiceForm.postingDate}
                              onChange={(e) => setInvoiceForm({ ...invoiceForm, postingDate: e.target.value })}
                              required
                            />
                          </div>
                          <div>
                            <label>Due </label>
                            <input
                              type="date"
                              value={invoiceForm.dueDate}
                              onChange={(e) => setInvoiceForm({ ...invoiceForm, dueDate: e.target.value })}
                              required
                            />
                          </div>
                          <button type="submit" disabled={busyId === o.id}>
                            Create draft invoice for remaining {money(orderRemaining(o))}
                          </button>
                        </form>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>New purchase order</h3>
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
              <label>Order date </label>
              <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} required />
            </div>
            <div>
              <label>Expected </label>
              <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
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
                <th>WH</th>
                <th>Cost center</th>
                <th>Line total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const isInventory = !!items.find((i) => i.id === line.itemId)?.isInventoryItem;
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
                    <td>
                      {isInventory ? (
                        <select value={line.warehouseId} onChange={(e) => updateLine(index, { warehouseId: e.target.value })} required>
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
                      <select value={line.costCenterId} onChange={(e) => updateLine(index, { costCenterId: e.target.value })}>
                        <option value="">—</option>
                        {costCenters.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.code}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{money(Number(line.quantity) * Number(line.unitPrice) || 0)}</td>
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
            <button type="button" className="secondary" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
              Add line
            </button>
            <strong>Total: {money(lines.reduce((sum, l) => sum + Number(l.quantity) * Number(l.unitPrice) || 0, 0))}</strong>
          </div>

          <button type="submit" disabled={submitting || !partnerId} style={{ marginTop: 12 }}>
            {submitting ? "Saving…" : "Create purchase order"}
          </button>
        </form>
      </div>
    </div>
  );
}
