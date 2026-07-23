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

interface AdjustmentRow {
  id: string;
  adjustmentNumber: string;
  direction: "IN" | "OUT";
  postingDate: string;
  reason: string;
  warehouse: { code: string };
  lines: Array<{ item: { code: string }; quantity: string; unitCost: string; totalCost: string }>;
}

export function StockAdjustmentPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [adjustments, setAdjustments] = useState<AdjustmentRow[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [direction, setDirection] = useState<"IN" | "OUT">("OUT");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<Array<{ itemId: string; quantity: string; unitCost: string }>>([
    { itemId: "", quantity: "1", unitCost: "" },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dateSort, setDateSort] = useState<"asc" | "desc">("desc");

  const load = useCallback(async () => {
    const [whRes, itemsRes, adjRes] = await Promise.all([
      apiClient.get<Warehouse[]>("/warehouses"),
      apiClient.get<Item[]>("/items"),
      apiClient.get<AdjustmentRow[]>("/inventory/adjustments"),
    ]);
    setWarehouses(whRes.data);
    setItems(itemsRes.data);
    setAdjustments(adjRes.data);
    if (!warehouseId) {
      const def = whRes.data.find((w) => w.isDefault);
      if (def) setWarehouseId(def.id);
    }
  }, [warehouseId]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.post("/inventory/adjustments", {
        warehouseId,
        direction,
        postingDate: new Date().toISOString(),
        reason,
        lines: lines
          .filter((l) => l.itemId)
          .map((l) => ({
            itemId: l.itemId,
            quantity: l.quantity,
            ...(direction === "IN" && l.unitCost ? { unitCost: l.unitCost } : {}),
          })),
      });
      setLines([{ itemId: "", quantity: "1", unitCost: "" }]);
      setReason("");
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Adjustment failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>New Stock Adjustment</h2>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
              <option value="" disabled>
                Warehouse…
              </option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </select>
            <select value={direction} onChange={(e) => setDirection(e.target.value as "IN" | "OUT")}>
              <option value="OUT">OUT (write-off / shrinkage)</option>
              <option value="IN">IN (found stock / opening balance)</option>
            </select>
            <input
              placeholder="Reason (required for audit)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              style={{ flex: 1 }}
            />
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
                placeholder="Qty"
                value={line.quantity}
                onChange={(e) => setLines((prev) => prev.map((l, i) => (i === index ? { ...l, quantity: e.target.value } : l)))}
                style={{ width: 100 }}
              />
              {direction === "IN" && (
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="Unit cost"
                  value={line.unitCost}
                  onChange={(e) => setLines((prev) => prev.map((l, i) => (i === index ? { ...l, unitCost: e.target.value } : l)))}
                  style={{ width: 110 }}
                  required
                />
              )}
              {lines.length > 1 && (
                <button type="button" className="secondary" onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}>
                  ×
                </button>
              )}
            </div>
          ))}
          <div className="form-row" style={{ justifyContent: "space-between" }}>
            <button type="button" className="secondary" onClick={() => setLines((prev) => [...prev, { itemId: "", quantity: "1", unitCost: "" }])}>
              Add line
            </button>
            <button type="submit" disabled={submitting || !warehouseId || !reason}>
              {submitting ? "Posting…" : "Post adjustment"}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h3>Adjustments</h3>
        <table>
          <thead>
            <tr>
              <th>Number</th>
              <th style={{ cursor: "pointer" }} onClick={() => setDateSort((d) => (d === "asc" ? "desc" : "asc"))}>
                Date {dateSort === "asc" ? "▲" : "▼"}
              </th>
              <th>WH</th>
              <th>Direction</th>
              <th>Reason</th>
              <th>Lines</th>
            </tr>
          </thead>
          <tbody>
            {[...adjustments]
              .sort((a, b) => (dateSort === "asc" ? a.postingDate.localeCompare(b.postingDate) : b.postingDate.localeCompare(a.postingDate)))
              .map((a) => (
              <tr key={a.id}>
                <td>{a.adjustmentNumber}</td>
                <td>{new Date(a.postingDate).toLocaleDateString()}</td>
                <td>{a.warehouse.code}</td>
                <td>
                  <span className={`badge ${a.direction === "IN" ? "posted" : "reversed"}`}>{a.direction}</span>
                </td>
                <td>{a.reason}</td>
                <td style={{ fontSize: 12 }}>
                  {a.lines.map((l, i) => (
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
