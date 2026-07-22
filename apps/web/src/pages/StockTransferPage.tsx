import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiClient } from "../api/client";

interface Warehouse {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
}

interface Item {
  id: string;
  code: string;
  name: string;
}

interface TransferRow {
  id: string;
  transferNumber: string;
  postingDate: string;
  fromWarehouse: { code: string };
  toWarehouse: { code: string };
  lines: Array<{ item: { code: string }; quantity: string; unitCost: string; totalCost: string }>;
}

export function StockTransferPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [fromWarehouseId, setFromWarehouseId] = useState("");
  const [toWarehouseId, setToWarehouseId] = useState("");
  const [lines, setLines] = useState<Array<{ itemId: string; quantity: string }>>([{ itemId: "", quantity: "1" }]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const [whRes, itemsRes, transfersRes] = await Promise.all([
      apiClient.get<Warehouse[]>("/warehouses"),
      apiClient.get<Item[]>("/items"),
      apiClient.get<TransferRow[]>("/inventory/transfers"),
    ]);
    setWarehouses(whRes.data);
    setItems(itemsRes.data);
    setTransfers(transfersRes.data);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.post("/inventory/transfers", {
        fromWarehouseId,
        toWarehouseId,
        postingDate: new Date().toISOString(),
        lines: lines.filter((l) => l.itemId),
      });
      setLines([{ itemId: "", quantity: "1" }]);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Transfer failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>New Stock Transfer</h2>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <select value={fromWarehouseId} onChange={(e) => setFromWarehouseId(e.target.value)} required>
              <option value="" disabled>
                From warehouse…
              </option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </select>
            <select value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)} required>
              <option value="" disabled>
                To warehouse…
              </option>
              {warehouses
                .filter((w) => w.id !== fromWarehouseId)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </option>
                ))}
            </select>
          </div>
          {lines.map((line, index) => (
            <div className="form-row" key={index}>
              <select
                value={line.itemId}
                onChange={(e) => setLines((prev) => prev.map((l, i) => (i === index ? { ...l, itemId: e.target.value } : l)))}
                style={{ flex: 1 }}
              >
                <option value="">Select item…</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.code} — {i.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0.000001"
                step="any"
                value={line.quantity}
                onChange={(e) => setLines((prev) => prev.map((l, i) => (i === index ? { ...l, quantity: e.target.value } : l)))}
                style={{ width: 110 }}
              />
              {lines.length > 1 && (
                <button type="button" className="secondary" onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}>
                  ×
                </button>
              )}
            </div>
          ))}
          <div className="form-row" style={{ justifyContent: "space-between" }}>
            <button type="button" className="secondary" onClick={() => setLines((prev) => [...prev, { itemId: "", quantity: "1" }])}>
              Add line
            </button>
            <button type="submit" disabled={submitting || !fromWarehouseId || !toWarehouseId}>
              {submitting ? "Transferring…" : "Post transfer"}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h3>Transfers</h3>
        <table>
          <thead>
            <tr>
              <th>Number</th>
              <th>Date</th>
              <th>From</th>
              <th>To</th>
              <th>Lines</th>
            </tr>
          </thead>
          <tbody>
            {transfers.map((t) => (
              <tr key={t.id}>
                <td>{t.transferNumber}</td>
                <td>{new Date(t.postingDate).toLocaleDateString()}</td>
                <td>{t.fromWarehouse.code}</td>
                <td>{t.toWarehouse.code}</td>
                <td style={{ fontSize: 12 }}>
                  {t.lines.map((l, i) => (
                    <span key={i}>
                      {l.item.code} × {Number(l.quantity)} @ {Number(l.unitCost).toFixed(2)}{" "}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
