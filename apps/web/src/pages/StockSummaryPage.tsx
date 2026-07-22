import { useEffect, useState } from "react";
import { apiClient } from "../api/client";

interface StockRow {
  itemId: string;
  itemCode: string;
  itemName: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  onHandQty: string;
  avgCost: string;
  totalValue: string;
}

interface Warehouse {
  id: string;
  code: string;
  name: string;
}

export function StockSummaryPage() {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [totalValue, setTotalValue] = useState("0");
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient.get<Warehouse[]>("/warehouses").then((res) => setWarehouses(res.data));
  }, []);

  useEffect(() => {
    setLoading(true);
    apiClient
      .get("/reports/stock-summary", { params: warehouseId ? { warehouseId } : {} })
      .then((res) => {
        setRows(res.data.rows);
        setTotalValue(res.data.totalValue);
      })
      .finally(() => setLoading(false));
  }, [warehouseId]);

  return (
    <div className="card">
      <div className="form-row" style={{ justifyContent: "space-between" }}>
        <h2>Stock Summary</h2>
        <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
          <option value="">All warehouses</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} — {w.name}
            </option>
          ))}
        </select>
      </div>
      {loading ? (
        <p>Loading…</p>
      ) : rows.length === 0 ? (
        <p>No stock on hand.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Warehouse</th>
              <th>On Hand</th>
              <th>Avg Cost</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.itemId}-${row.warehouseId}`}>
                <td>
                  {row.itemCode} — {row.itemName}
                </td>
                <td>{row.warehouseCode}</td>
                <td>{Number(row.onHandQty)}</td>
                <td>{Number(row.avgCost).toFixed(2)}</td>
                <td>{Number(row.totalValue).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>
                <strong>Total inventory value (reconciles to GL 1310)</strong>
              </td>
              <td>
                <strong>{Number(totalValue).toFixed(2)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
