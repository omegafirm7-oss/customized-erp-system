import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiClient } from "../api/client";

interface NoteRow {
  id: string;
  deliveryNumber: string | null;
  status: string;
  deliveryDate: string;
  salesOrder: { orderNumber: string | null; businessPartner: { code: string; name: string } };
}

interface OrderRow {
  id: string;
  orderNumber: string | null;
  status: string;
  businessPartner: { name: string };
}

const BADGE: Record<string, string> = { DRAFT: "draft", DISPATCHED: "draft", DELIVERED: "posted", CANCELLED: "reversed" };

export function DeliveryNotesPage() {
  const navigate = useNavigate();
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ salesOrderId: "", deliveryDate: new Date().toISOString().slice(0, 10), deliveryAddress: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [n, o] = await Promise.all([apiClient.get<NoteRow[]>("/ar/delivery-notes"), apiClient.get<OrderRow[]>("/ar/orders")]);
      setNotes(n.data);
      setOrders(o.data.filter((x) => ["CONFIRMED", "PARTIALLY_INVOICED", "INVOICED"].includes(x.status)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await apiClient.post<{ id: string }>("/ar/delivery-notes", {
        salesOrderId: form.salesOrderId,
        deliveryDate: new Date(form.deliveryDate).toISOString(),
        deliveryAddress: form.deliveryAddress || undefined,
      });
      navigate(`/ar/delivery-notes/${res.data.id}`);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create delivery note");
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>New delivery note</h2>
        <p style={{ color: "#667085", fontSize: 13 }}>
          Raised against a confirmed sales order. It lists what is still to be delivered; adjust the quantities, add the vehicle and driver, dispatch it, then record who signed for the goods.
        </p>
        <form onSubmit={create} className="form-row">
          <label>
            Sales order
            <select required value={form.salesOrderId} onChange={(e) => setForm({ ...form, salesOrderId: e.target.value })}>
              <option value="">Select…</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.orderNumber} — {o.businessPartner.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Delivery date
            <input type="date" required value={form.deliveryDate} onChange={(e) => setForm({ ...form, deliveryDate: e.target.value })} />
          </label>
          <label>
            Delivery address
            <input value={form.deliveryAddress} onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })} placeholder="Site / address" />
          </label>
          <button disabled={busy || !form.salesOrderId}>Create</button>
        </form>
        {error && <div className="error-banner">{error}</div>}
      </div>

      <div className="card">
        <h2>Delivery notes</h2>
        {loading ? (
          <p>Loading…</p>
        ) : notes.length === 0 ? (
          <p>No delivery notes yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Number</th>
                <th>Customer</th>
                <th>Sales order</th>
                <th>Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {notes.map((n) => (
                <tr key={n.id}>
                  <td>
                    <Link to={`/ar/delivery-notes/${n.id}`}>{n.deliveryNumber}</Link>
                  </td>
                  <td>{n.salesOrder.businessPartner.name}</td>
                  <td>{n.salesOrder.orderNumber}</td>
                  <td>{new Date(n.deliveryDate).toLocaleDateString()}</td>
                  <td>
                    <span className={`badge ${BADGE[n.status] ?? "draft"}`}>{n.status}</span>
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
