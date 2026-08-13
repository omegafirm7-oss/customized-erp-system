import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../api/client";

interface Item {
  id: string;
  code: string;
  name: string;
}

interface ProjectRef {
  id: string;
  code: string;
  name: string;
  status: string;
}

interface RequisitionLine {
  itemId: string;
  description: string;
  quantity: string;
  estimatedUnitPrice: string;
}

interface Requisition {
  id: string;
  requisitionNumber: string | null;
  status: string;
  createdAt: string;
  project: { code: string; name: string } | null;
  lines: Array<{ quantity: string; estimatedUnitPrice: string | null }>;
}

function emptyLine(): RequisitionLine {
  return { itemId: "", description: "", quantity: "1", estimatedUnitPrice: "" };
}

function money(v: string | number): string {
  return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function estimatedTotal(req: Requisition): number {
  return req.lines.reduce((sum, l) => sum + Number(l.quantity) * Number(l.estimatedUnitPrice ?? 0), 0);
}

export function PurchaseRequisitionsPage() {
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [projectId, setProjectId] = useState("");
  const [requiredByDate, setRequiredByDate] = useState("");
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<RequisitionLine[]>([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    return apiClient
      .get<Requisition[]>("/procurement/requisitions")
      .then((res) => setRequisitions(res.data))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    apiClient.get<Item[]>("/items").then((res) => setItems(res.data));
    apiClient.get<ProjectRef[]>("/projects").then((res) => setProjects(res.data.filter((p) => p.status !== "CLOSED")));
  }, [load]);

  function updateLine(index: number, patch: Partial<RequisitionLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function selectItem(index: number, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    updateLine(index, { itemId, description: item ? item.name : "" });
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.post("/procurement/requisitions", {
        projectId: projectId || undefined,
        requiredByDate: requiredByDate ? new Date(requiredByDate).toISOString() : undefined,
        memo: memo || undefined,
        lines: lines.map((l) => ({
          itemId: l.itemId || undefined,
          description: l.description,
          quantity: l.quantity,
          estimatedUnitPrice: l.estimatedUnitPrice || undefined,
        })),
      });
      setProjectId("");
      setRequiredByDate("");
      setMemo("");
      setLines([emptyLine()]);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create requisition");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>Purchase Requisitions</h2>
        <p style={{ color: "#667085", fontSize: 13 }}>
          Internal request for goods/services, requiring approval before any vendor is contacted. Approved
          requisitions can be sent as an RFQ to one or more vendors for comparison.
        </p>
        {error && <div className="error-banner">{error}</div>}
        {loading ? (
          <p>Loading…</p>
        ) : requisitions.length === 0 ? (
          <p>No requisitions yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Number</th>
                <th>Project</th>
                <th>Requested</th>
                <th>Estimated total</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {requisitions.map((r) => (
                <tr key={r.id}>
                  <td>{r.requisitionNumber ?? "(draft)"}</td>
                  <td>{r.project ? r.project.code : "—"}</td>
                  <td>{new Date(r.createdAt).toLocaleDateString()}</td>
                  <td>{money(estimatedTotal(r))}</td>
                  <td>
                    <span
                      className={`badge ${
                        r.status === "APPROVED" || r.status === "CLOSED"
                          ? "posted"
                          : r.status === "REJECTED" || r.status === "CANCELLED"
                            ? "reversed"
                            : "draft"
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td>
                    <Link to={`/procurement/requisitions/${r.id}`}>Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>New requisition</h3>
        <form onSubmit={handleCreate}>
          <div className="form-row">
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={{ flex: 1 }}>
              <option value="">(no project)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
            <div>
              <label>Required by </label>
              <input type="date" value={requiredByDate} onChange={(e) => setRequiredByDate(e.target.value)} />
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
                <th>Est. unit price</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
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
                    <input type="number" min="0" step="0.01" style={{ width: 90 }} value={line.estimatedUnitPrice} onChange={(e) => updateLine(index, { estimatedUnitPrice: e.target.value })} />
                  </td>
                  <td>
                    {lines.length > 1 && (
                      <button type="button" className="secondary" onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}>
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="form-row" style={{ justifyContent: "space-between", marginTop: 10 }}>
            <button type="button" className="secondary" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
              Add line
            </button>
          </div>

          <button type="submit" disabled={submitting} style={{ marginTop: 12 }}>
            {submitting ? "Saving…" : "Create requisition"}
          </button>
        </form>
      </div>
    </div>
  );
}
