import { useEffect, useState } from "react";
import { apiClient } from "../api/client";

interface Movement {
  id: string;
  createdAt: string;
  postingDate: string;
  movementType: string;
  itemCode: string;
  warehouseCode: string;
  signedQty: string;
  unitCost: string;
  totalCost: string;
  qtyAfter: string;
  avgCostAfter: string;
  sourceDocumentType: string;
  memo: string | null;
}

interface Item {
  id: string;
  code: string;
  name: string;
}

export function StockMovementsPage() {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [itemId, setItemId] = useState("");
  const [loading, setLoading] = useState(true);
  const [dateSort, setDateSort] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    apiClient.get<Item[]>("/items").then((res) => setItems(res.data));
  }, []);

  useEffect(() => {
    setLoading(true);
    apiClient
      .get<Movement[]>("/reports/stock-movements", { params: itemId ? { itemId } : {} })
      .then((res) => setMovements(res.data))
      .finally(() => setLoading(false));
  }, [itemId]);

  return (
    <div className="card">
      <div className="form-row" style={{ justifyContent: "space-between" }}>
        <h2>Stock Movements</h2>
        <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
          <option value="">All items</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.code} — {i.name}
            </option>
          ))}
        </select>
      </div>
      {loading ? (
        <p>Loading…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th style={{ cursor: "pointer" }} onClick={() => setDateSort((d) => (d === "asc" ? "desc" : "asc"))}>
                Date {dateSort === "asc" ? "▲" : "▼"}
              </th>
              <th>Type</th>
              <th>Item</th>
              <th>WH</th>
              <th>Qty ±</th>
              <th>Unit Cost</th>
              <th>Total Cost</th>
              <th>Balance</th>
              <th>Avg After</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {[...movements]
              .sort((a, b) => (dateSort === "asc" ? a.postingDate.localeCompare(b.postingDate) : b.postingDate.localeCompare(a.postingDate)))
              .map((m) => (
              <tr key={m.id}>
                <td>{new Date(m.postingDate).toLocaleDateString()}</td>
                <td>{m.movementType.replace("_", " ")}</td>
                <td>{m.itemCode}</td>
                <td>{m.warehouseCode}</td>
                <td style={{ color: Number(m.signedQty) < 0 ? "#912018" : "#027a48" }}>{Number(m.signedQty)}</td>
                <td>{Number(m.unitCost).toFixed(2)}</td>
                <td>{Number(m.totalCost).toFixed(2)}</td>
                <td>{Number(m.qtyAfter)}</td>
                <td>{Number(m.avgCostAfter).toFixed(2)}</td>
                <td style={{ fontSize: 11 }}>{m.sourceDocumentType.replace("_", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
