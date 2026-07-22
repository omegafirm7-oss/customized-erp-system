import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../api/client";

interface PaymentRow {
  id: string;
  paymentNumber: string | null;
  direction: "INCOMING" | "OUTGOING";
  paymentDate: string;
  amount: string;
  allocatedAmount: string;
  unallocatedAmount: string;
  reference: string | null;
  status: "POSTED" | "CANCELLED";
  businessPartner?: { code: string; name: string };
  bankCashAccount?: { code: string; name: string };
}

export function PaymentsPage() {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [direction, setDirection] = useState<"ALL" | "INCOMING" | "OUTGOING">("ALL");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = direction !== "ALL" ? { direction } : {};
    return apiClient
      .get<PaymentRow[]>("/payments", { params })
      .then((res) => setPayments(res.data))
      .finally(() => setLoading(false));
  }, [direction]);

  useEffect(() => {
    load();
  }, [load]);

  async function cancel(id: string) {
    setError(null);
    setBusyId(id);
    try {
      await apiClient.post(`/payments/${id}/cancel`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to cancel payment");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Payments</h2>
        <span>
          <Link to="/payments/new?direction=INCOMING">
            <button>Receive payment</button>
          </Link>{" "}
          <Link to="/payments/new?direction=OUTGOING">
            <button className="secondary">Pay vendor</button>
          </Link>
        </span>
      </div>
      <div className="form-row">
        {(["ALL", "INCOMING", "OUTGOING"] as const).map((d) => (
          <button key={d} type="button" className={d === direction ? "" : "secondary"} onClick={() => setDirection(d)}>
            {d}
          </button>
        ))}
      </div>
      {error && <div className="error-banner">{error}</div>}
      {loading ? (
        <p>Loading…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Number</th>
              <th>Direction</th>
              <th>Partner</th>
              <th>Date</th>
              <th>Amount</th>
              <th>Allocated</th>
              <th>On Account</th>
              <th>Account</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id}>
                <td>{p.paymentNumber}</td>
                <td>{p.direction}</td>
                <td>{p.businessPartner?.name}</td>
                <td>{new Date(p.paymentDate).toLocaleDateString()}</td>
                <td>{Number(p.amount).toFixed(2)}</td>
                <td>{Number(p.allocatedAmount).toFixed(2)}</td>
                <td>{Number(p.unallocatedAmount).toFixed(2)}</td>
                <td>{p.bankCashAccount ? `${p.bankCashAccount.code}` : ""}</td>
                <td>
                  <span className={`badge ${p.status === "POSTED" ? "posted" : "reversed"}`}>{p.status}</span>
                </td>
                <td>
                  {p.status === "POSTED" && (
                    <button className="secondary" disabled={busyId === p.id} onClick={() => cancel(p.id)}>
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
