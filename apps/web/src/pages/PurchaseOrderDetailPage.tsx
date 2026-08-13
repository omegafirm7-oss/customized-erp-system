import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiClient } from "../api/client";

interface OrderLine {
  id: string;
  description: string;
  quantity: string;
  invoicedQuantity: string;
  receivedQuantity: string;
  unitPrice: string;
}

interface OrderDetail {
  id: string;
  orderNumber: string | null;
  status: string;
  orderDate: string;
  businessPartner: { code: string; name: string };
  lines: OrderLine[];
}

interface Receipt {
  id: string;
  receiptNumber: string | null;
  status: string;
  receivedDate: string;
  warehouse: { code: string; name: string };
}

interface Warehouse {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
}

interface Mismatch {
  lineId: string;
  description: string;
  quantityToInvoice: string;
  quantityAccepted: string;
  matches: boolean;
}

function money(v: string | number): string {
  return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function orderTotal(order: OrderDetail): number {
  return order.lines.reduce((sum, l) => sum + Number(l.quantity) * Number(l.unitPrice), 0);
}

function orderRemaining(order: OrderDetail): number {
  return order.lines.reduce((sum, l) => sum + (Number(l.quantity) - Number(l.invoicedQuantity)) * Number(l.unitPrice), 0);
}

export function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [mismatches, setMismatches] = useState<Mismatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showGrnForm, setShowGrnForm] = useState(false);
  const [grnForm, setGrnForm] = useState({ warehouseId: "", receivedDate: new Date().toISOString().slice(0, 10) });
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState({
    vendorInvoiceNumber: "",
    postingDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10),
  });

  const load = useCallback(async () => {
    const [orderRes, receiptsRes] = await Promise.all([
      apiClient.get<OrderDetail>(`/ap/orders/${id}`),
      apiClient.get<Receipt[]>("/procurement/goods-receipts", { params: { purchaseOrderId: id } }),
    ]);
    setOrder(orderRes.data);
    setReceipts(receiptsRes.data);
  }, [id]);

  useEffect(() => {
    load();
    apiClient.get<Warehouse[]>("/warehouses").then((res) => setWarehouses(res.data));
  }, [load]);

  async function createReceipt(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await apiClient.post<{ id: string }>("/procurement/goods-receipts", {
        purchaseOrderId: id,
        warehouseId: grnForm.warehouseId,
        receivedDate: new Date(grnForm.receivedDate).toISOString(),
      });
      navigate(`/procurement/goods-receipts/${res.data.id}`);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create goods receipt");
      setBusy(false);
    }
  }

  async function openInvoiceForm() {
    setError(null);
    try {
      const res = await apiClient.get<{ mismatches: Mismatch[] }>(`/ap/orders/${id}/three-way-match-warning`);
      setMismatches(res.data.mismatches);
    } catch {
      setMismatches([]);
    }
    setShowInvoiceForm((s) => !s);
  }

  async function submitGenerateInvoice(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(`/ap/orders/${id}/generate-invoice`, {
        vendorInvoiceNumber: invoiceForm.vendorInvoiceNumber,
        postingDate: new Date(invoiceForm.postingDate).toISOString(),
        dueDate: new Date(invoiceForm.dueDate).toISOString(),
      });
      navigate("/ap/invoices");
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to generate invoice");
    } finally {
      setBusy(false);
    }
  }

  if (!order) return <p>Loading…</p>;
  const canReceive = order.lines.some((l) => Number(l.quantity) - Number(l.receivedQuantity) > 0) && order.status !== "CANCELLED";
  const canInvoice = (order.status === "SENT" || order.status === "PARTIALLY_INVOICED") && order.lines.some((l) => Number(l.quantity) - Number(l.invoicedQuantity) > 0);

  return (
    <div>
      <div className="card">
        <h2>
          Purchase Order {order.orderNumber ?? "(draft)"}{" "}
          <span className={`badge ${order.status === "INVOICED" ? "posted" : order.status === "CANCELLED" ? "reversed" : "draft"}`}>{order.status}</span>
        </h2>
        {error && <div className="error-banner">{error}</div>}
        <p style={{ color: "#667085", fontSize: 13 }}>
          Vendor {order.businessPartner.code} — {order.businessPartner.name} · {new Date(order.orderDate).toLocaleDateString()}
        </p>
        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th>Qty</th>
              <th>Received</th>
              <th>Invoiced</th>
              <th>Unit price</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.description}</td>
                <td>{l.quantity}</td>
                <td>{l.receivedQuantity}</td>
                <td>{l.invoicedQuantity}</td>
                <td>{money(l.unitPrice)}</td>
                <td>{money(Number(l.quantity) * Number(l.unitPrice))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          <strong>Total: {money(orderTotal(order))}</strong> · Remaining to invoice: {money(orderRemaining(order))}
        </p>
        <div className="form-row">
          {canReceive && (
            <button className="secondary" disabled={busy} onClick={() => setShowGrnForm((s) => !s)}>
              Create Goods Receipt
            </button>
          )}
          {canInvoice && (
            <button disabled={busy} onClick={openInvoiceForm}>
              Generate Invoice
            </button>
          )}
        </div>

        {showGrnForm && (
          <form onSubmit={createReceipt} className="form-row" style={{ marginTop: 10 }}>
            <select value={grnForm.warehouseId} onChange={(e) => setGrnForm({ ...grnForm, warehouseId: e.target.value })} required>
              <option value="" disabled>
                Select warehouse…
              </option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </select>
            <div>
              <label>Received date </label>
              <input type="date" value={grnForm.receivedDate} onChange={(e) => setGrnForm({ ...grnForm, receivedDate: e.target.value })} required />
            </div>
            <button type="submit" disabled={busy}>
              Create receipt (prefills remaining quantities)
            </button>
          </form>
        )}

        {showInvoiceForm && (
          <>
            {mismatches.length > 0 && (
              <div className="error-banner" style={{ background: "#fffaeb", borderColor: "#f79009", color: "#93370d", marginTop: 10 }}>
                <strong>Three-way match warning:</strong> the quantity being invoiced differs from what was accepted on a
                completed goods receipt for {mismatches.length} line(s). This does not block posting — review before continuing.
                <ul style={{ margin: "6px 0 0 18px" }}>
                  {mismatches.map((m) => (
                    <li key={m.lineId}>
                      {m.description}: invoicing {m.quantityToInvoice}, accepted {m.quantityAccepted}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <form onSubmit={submitGenerateInvoice} className="form-row" style={{ marginTop: 10 }}>
              <input
                placeholder="Vendor invoice number"
                value={invoiceForm.vendorInvoiceNumber}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, vendorInvoiceNumber: e.target.value })}
                required
              />
              <div>
                <label>Posting </label>
                <input type="date" value={invoiceForm.postingDate} onChange={(e) => setInvoiceForm({ ...invoiceForm, postingDate: e.target.value })} required />
              </div>
              <div>
                <label>Due </label>
                <input type="date" value={invoiceForm.dueDate} onChange={(e) => setInvoiceForm({ ...invoiceForm, dueDate: e.target.value })} required />
              </div>
              <button type="submit" disabled={busy}>
                Create draft invoice for remaining {money(orderRemaining(order))}
              </button>
            </form>
          </>
        )}
      </div>

      <div className="card">
        <h3>Goods receipts</h3>
        {receipts.length === 0 ? (
          <p>No goods receipts yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Number</th>
                <th>Warehouse</th>
                <th>Received date</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id}>
                  <td>{r.receiptNumber ?? "(draft)"}</td>
                  <td>{r.warehouse.code}</td>
                  <td>{new Date(r.receivedDate).toLocaleDateString()}</td>
                  <td>
                    <span className={`badge ${r.status === "COMPLETED" ? "posted" : r.status === "CANCELLED" ? "reversed" : "draft"}`}>{r.status}</span>
                  </td>
                  <td>
                    <Link to={`/procurement/goods-receipts/${r.id}`}>Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
