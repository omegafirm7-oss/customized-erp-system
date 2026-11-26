import { FormEvent, useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiClient } from "../api/client";
import { useCanDownload } from "../hooks/useCanDownload";
import { useDocumentPdfDownload } from "../hooks/useDocumentPdfDownload";

interface NoteLine {
  id: string;
  salesOrderLineId: string;
  quantity: string;
  orderedQuantity: string;
  deliveredElsewhere: string;
  salesOrderLine: { description: string; item?: { code: string } | null };
}

interface NoteDetail {
  id: string;
  deliveryNumber: string | null;
  status: string;
  deliveryDate: string;
  deliveryAddress: string | null;
  vehicleNumber: string | null;
  driverName: string | null;
  receivedByName: string | null;
  deliveredAt: string | null;
  memo: string | null;
  salesOrderId: string;
  salesOrder: { orderNumber: string | null; businessPartner: { code: string; name: string; taxRegistrationNumber?: string | null } };
  lines: NoteLine[];
}

const BADGE: Record<string, string> = { DRAFT: "draft", DISPATCHED: "draft", DELIVERED: "posted", CANCELLED: "reversed" };

export function DeliveryNoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const canDownload = useCanDownload();
  const { download } = useDocumentPdfDownload("sales");
  const [note, setNote] = useState<NoteDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState({ vehicleNumber: "", driverName: "", deliveryAddress: "", memo: "" });
  const [receivedBy, setReceivedBy] = useState("");

  const load = useCallback(async () => {
    const res = await apiClient.get<NoteDetail>(`/ar/delivery-notes/${id}`);
    setNote(res.data);
    setDetails({
      vehicleNumber: res.data.vehicleNumber ?? "",
      driverName: res.data.driverName ?? "",
      deliveryAddress: res.data.deliveryAddress ?? "",
      memo: res.data.memo ?? "",
    });
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(fn: () => Promise<unknown>, fallback: string) {
    setError(null);
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? fallback);
    } finally {
      setBusy(false);
    }
  }

  const saveDetails = (e?: FormEvent) => {
    e?.preventDefault();
    return run(() => apiClient.post(`/ar/delivery-notes/${id}/update`, details), "Failed to save details");
  };

  function downloadPdf() {
    if (!note) return;
    const refs: Array<[string, string]> = [["Sales Order", note.salesOrder.orderNumber ?? "(draft)"]];
    if (note.deliveryAddress) refs.push(["Deliver to", note.deliveryAddress]);
    if (note.vehicleNumber) refs.push(["Vehicle No.", note.vehicleNumber]);
    if (note.driverName) refs.push(["Driver", note.driverName]);
    if (note.receivedByName) refs.push(["Received by", `${note.receivedByName}${note.deliveredAt ? ` on ${new Date(note.deliveredAt).toLocaleDateString()}` : ""}`]);
    download({
      docTypeLabel: "Delivery Note",
      documentNumber: note.deliveryNumber,
      documentDate: note.deliveryDate,
      status: note.status,
      recordId: note.id,
      partnerLabel: "Customer",
      partner: note.salesOrder.businessPartner,
      references: refs,
      notes: note.memo,
      signatures: ["Dispatched by", "Driver", "Received by (customer)"],
      lines: [],
      plainTable: {
        head: ["#", "Code", "Description", "Ordered", "Delivered now", "Delivered earlier", "Balance"],
        rightAlign: [3, 4, 5, 6],
        body: note.lines.map((l, i) => {
          const now = Number(l.quantity);
          const earlier = Number(l.deliveredElsewhere);
          return [String(i + 1), l.salesOrderLine.item?.code ?? "", l.salesOrderLine.description, String(Number(l.orderedQuantity)), String(now), String(earlier), String(Number(l.orderedQuantity) - earlier - now)];
        }),
      },
    });
  }

  if (!note) return <p>Loading…</p>;
  const isDraft = note.status === "DRAFT";

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>
            Delivery Note {note.deliveryNumber} <span className={`badge ${BADGE[note.status] ?? "draft"}`}>{note.status}</span>
          </h2>
          <span>
            {canDownload && (
              <>
                <button className="secondary" onClick={downloadPdf}>
                  PDF
                </button>{" "}
              </>
            )}
            {isDraft && (
              <button disabled={busy} onClick={() => run(() => apiClient.post(`/ar/delivery-notes/${id}/dispatch`), "Failed to dispatch")}>
                Dispatch
              </button>
            )}{" "}
            {(isDraft || note.status === "DISPATCHED") && (
              <button className="secondary" disabled={busy} onClick={() => window.confirm("Cancel this delivery note? Its quantities become available again.") && run(() => apiClient.post(`/ar/delivery-notes/${id}/cancel`), "Failed to cancel")}>
                Cancel
              </button>
            )}
          </span>
        </div>
        {error && <div className="error-banner">{error}</div>}
        <p style={{ color: "#667085", fontSize: 13 }}>
          Customer {note.salesOrder.businessPartner.name} · Sales order {note.salesOrder.orderNumber} · {new Date(note.deliveryDate).toLocaleDateString()}
          {note.receivedByName && ` · Received by ${note.receivedByName}${note.deliveredAt ? ` on ${new Date(note.deliveredAt).toLocaleDateString()}` : ""}`}
        </p>

        <form onSubmit={saveDetails} className="form-row">
          <label>
            Deliver to
            <input disabled={!isDraft} value={details.deliveryAddress} onChange={(e) => setDetails({ ...details, deliveryAddress: e.target.value })} />
          </label>
          <label>
            Vehicle no.
            <input disabled={!isDraft} value={details.vehicleNumber} onChange={(e) => setDetails({ ...details, vehicleNumber: e.target.value })} />
          </label>
          <label>
            Driver
            <input disabled={!isDraft} value={details.driverName} onChange={(e) => setDetails({ ...details, driverName: e.target.value })} />
          </label>
          <label>
            Notes
            <input disabled={!isDraft} value={details.memo} onChange={(e) => setDetails({ ...details, memo: e.target.value })} />
          </label>
          {isDraft && <button disabled={busy}>Save details</button>}
        </form>

        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th>Ordered</th>
              <th>Delivered earlier</th>
              <th>Delivering now</th>
            </tr>
          </thead>
          <tbody>
            {note.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.salesOrderLine.description}</td>
                <td>{Number(l.orderedQuantity)}</td>
                <td>{Number(l.deliveredElsewhere)}</td>
                <td>
                  {isDraft ? (
                    <input
                      type="number"
                      min="0"
                      step="any"
                      style={{ width: 100 }}
                      defaultValue={l.quantity}
                      onBlur={(e) => {
                        if (e.target.value !== l.quantity) run(() => apiClient.post(`/ar/delivery-notes/${id}/lines/${l.id}`, { quantity: e.target.value }), "Failed to update quantity");
                      }}
                    />
                  ) : (
                    Number(l.quantity)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {note.status === "DISPATCHED" && (
        <div className="card">
          <h3>Customer has received the goods</h3>
          <form
            className="form-row"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => apiClient.post(`/ar/delivery-notes/${id}/delivered`, { receivedByName: receivedBy }), "Failed to mark delivered");
            }}
          >
            <label>
              Received by (name of person who signed)
              <input required value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} />
            </label>
            <button disabled={busy || !receivedBy.trim()}>Mark delivered</button>
          </form>
        </div>
      )}
    </div>
  );
}
