import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiClient } from "../api/client";

interface ReceiptLine {
  id: string;
  purchaseOrderLineId: string;
  quantityReceived: string;
  qcResult: string;
  quantityAccepted: string;
  quantityRejected: string;
  qcNotes: string | null;
  purchaseOrderLine: { description: string; quantity: string; unitPrice: string };
}

interface ReceiptDetail {
  id: string;
  purchaseOrderId: string;
  receiptNumber: string | null;
  status: string;
  receivedDate: string;
  purchaseOrder: { orderNumber: string | null; businessPartner: { code: string; name: string } };
  warehouse: { code: string; name: string };
  lines: ReceiptLine[];
}

const QC_RESULTS = ["PASSED", "FAILED", "PARTIAL"];

export function GoodsReceiptDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [receipt, setReceipt] = useState<ReceiptDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [qcDrafts, setQcDrafts] = useState<Record<string, { qcResult: string; quantityAccepted: string; quantityRejected: string; qcNotes: string }>>({});

  const load = useCallback(async () => {
    const res = await apiClient.get<ReceiptDetail>(`/procurement/goods-receipts/${id}`);
    setReceipt(res.data);
    const drafts: typeof qcDrafts = {};
    for (const line of res.data.lines) {
      drafts[line.id] = {
        qcResult: line.qcResult === "PENDING" ? "PASSED" : line.qcResult,
        quantityAccepted: line.quantityAccepted !== "0" ? line.quantityAccepted : line.quantityReceived,
        quantityRejected: line.quantityRejected,
        qcNotes: line.qcNotes ?? "",
      };
    }
    setQcDrafts(drafts);
  }, [id]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function updateQuantityReceived(lineId: string, value: string) {
    setError(null);
    try {
      await apiClient.post(`/procurement/goods-receipts/${id}/lines/${lineId}`, { quantityReceived: value });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to update line");
    }
  }

  async function submitForQc() {
    setError(null);
    setBusy(true);
    try {
      await apiClient.post(`/procurement/goods-receipts/${id}/submit-for-qc`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to submit for QC");
    } finally {
      setBusy(false);
    }
  }

  async function recordQc(lineId: string) {
    const draft = qcDrafts[lineId];
    setError(null);
    try {
      await apiClient.post(`/procurement/goods-receipts/${id}/lines/${lineId}/qc`, draft);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to record QC result");
    }
  }

  async function complete() {
    if (!window.confirm("Complete this goods receipt? This updates the purchase order's received quantities.")) return;
    setError(null);
    setBusy(true);
    try {
      await apiClient.post(`/procurement/goods-receipts/${id}/complete`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to complete goods receipt");
    } finally {
      setBusy(false);
    }
  }

  if (!receipt) return <p>Loading…</p>;
  const isDraft = receipt.status === "DRAFT";
  const isQcPending = receipt.status === "QC_PENDING";
  const allQcSet = receipt.lines.every((l) => l.qcResult !== "PENDING");

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>
            Goods Receipt {receipt.receiptNumber ?? "(draft)"}{" "}
            <span className={`badge ${receipt.status === "COMPLETED" ? "posted" : receipt.status === "CANCELLED" ? "reversed" : "draft"}`}>
              {receipt.status}
            </span>
          </h2>
          <span>
            {isDraft && (
              <button disabled={busy} onClick={submitForQc}>
                Submit for QC
              </button>
            )}
            {isQcPending && (
              <button disabled={busy || !allQcSet} onClick={complete}>
                Complete
              </button>
            )}
          </span>
        </div>
        {error && <div className="error-banner">{error}</div>}
        <p style={{ color: "#667085", fontSize: 13 }}>
          PO <Link to={`/ap/orders/${receipt.purchaseOrderId}`}>{receipt.purchaseOrder.orderNumber ?? "(draft)"}</Link> — Vendor{" "}
          {receipt.purchaseOrder.businessPartner.name} · Warehouse {receipt.warehouse.code} · Received{" "}
          {new Date(receipt.receivedDate).toLocaleDateString()}
        </p>

        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th>Ordered</th>
              <th>Qty received</th>
              {isQcPending || receipt.status === "COMPLETED" ? (
                <>
                  <th>QC result</th>
                  <th>Accepted</th>
                  <th>Rejected</th>
                  <th>Notes</th>
                  <th></th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {receipt.lines.map((line) => {
              const draft = qcDrafts[line.id] ?? { qcResult: "PASSED", quantityAccepted: "0", quantityRejected: "0", qcNotes: "" };
              return (
                <tr key={line.id}>
                  <td>{line.purchaseOrderLine.description}</td>
                  <td>{line.purchaseOrderLine.quantity}</td>
                  <td>
                    {isDraft ? (
                      <input
                        type="number"
                        min="0"
                        step="any"
                        style={{ width: 90 }}
                        defaultValue={line.quantityReceived}
                        onBlur={(e) => {
                          if (e.target.value !== line.quantityReceived) updateQuantityReceived(line.id, e.target.value);
                        }}
                      />
                    ) : (
                      line.quantityReceived
                    )}
                  </td>
                  {isQcPending ? (
                    <>
                      <td>
                        <select
                          value={draft.qcResult}
                          onChange={(e) => setQcDrafts((prev) => ({ ...prev, [line.id]: { ...prev[line.id], qcResult: e.target.value } }))}
                        >
                          {QC_RESULTS.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          style={{ width: 80 }}
                          value={draft.quantityAccepted}
                          onChange={(e) => setQcDrafts((prev) => ({ ...prev, [line.id]: { ...prev[line.id], quantityAccepted: e.target.value } }))}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          style={{ width: 80 }}
                          value={draft.quantityRejected}
                          onChange={(e) => setQcDrafts((prev) => ({ ...prev, [line.id]: { ...prev[line.id], quantityRejected: e.target.value } }))}
                        />
                      </td>
                      <td>
                        <input
                          placeholder="Notes"
                          value={draft.qcNotes}
                          onChange={(e) => setQcDrafts((prev) => ({ ...prev, [line.id]: { ...prev[line.id], qcNotes: e.target.value } }))}
                        />
                      </td>
                      <td>
                        <button className="secondary" onClick={() => recordQc(line.id)}>
                          {line.qcResult === "PENDING" ? "Record" : "Update"}
                        </button>
                      </td>
                    </>
                  ) : receipt.status === "COMPLETED" ? (
                    <>
                      <td>{line.qcResult}</td>
                      <td>{line.quantityAccepted}</td>
                      <td>{line.quantityRejected}</td>
                      <td>{line.qcNotes ?? "—"}</td>
                      <td></td>
                    </>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
