import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { formatAmount } from "../utils/currency";

interface MisallocatedPayment {
  paymentId: string;
  category: "ALLOWANCE" | "FOOD";
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  amount: string;
  paymentDate: string;
  memo: string | null;
  currentAccountId: string | null;
  currentAccountCode: string | null;
  currentAccountName: string | null;
}

interface Account {
  id: string;
  code: string;
  name: string;
  isPostable: boolean;
}

interface BulkResult {
  count: number;
  totalAmount: string;
}

/**
 * Corrects posted payments sitting on the wrong expense account — ALLOWANCE
 * payments that were really Food, and FOOD payments still pointing at the
 * pre-split default account. Posted entries can't be silently edited (a DB
 * trigger blocks it, on purpose, for audit-trail integrity) — every
 * correction reverses the original entry and posts a new one on the right
 * account. Administrator-only; the per-row action needs an explicit
 * confirm, and the bulk Food fix (an unambiguous mechanical correction,
 * not a judgment call) needs one confirm for the whole batch.
 */
export function ReclassifyAllowancePaymentsPage() {
  const { user } = useAuth();
  const isAdministrator = user?.roleName === "Administrator";
  const [payments, setPayments] = useState<MisallocatedPayment[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiClient.get<MisallocatedPayment[]>("/hr/employee-payments/allowance").then((res) => setPayments(res.data));
  }

  useEffect(load, []);
  useEffect(() => {
    apiClient.get<Account[]>("/coa/accounts").then((res) => setAccounts(res.data.filter((a) => a.isPostable)));
  }, []);

  const foodRows = (payments ?? []).filter((p) => p.category === "FOOD");

  async function reclassify(p: MisallocatedPayment) {
    const targetId = selectedAccount[p.paymentId];
    if (!targetId) return;
    const target = accounts.find((a) => a.id === targetId);
    if (
      !window.confirm(
        `Reverse ${p.employeeCode} — ${p.employeeName}'s ${formatAmount(p.amount)} ${p.category === "ALLOWANCE" ? "Allowance" : "Food"} payment` +
          (p.currentAccountName ? ` on ${p.currentAccountCode} ${p.currentAccountName}` : "") +
          ` and repost the identical amount on ${target?.code} ${target?.name}? This is a visible correction (reversal + new entry), not a silent edit.`,
      )
    ) {
      return;
    }
    setError(null);
    setBusyId(p.paymentId);
    try {
      await apiClient.post(`/hr/employee-payments/${p.paymentId}/reclassify-account`, { expenseAccountId: targetId });
      load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to reclassify payment");
    } finally {
      setBusyId(null);
    }
  }

  async function bulkReclassifyFood() {
    if (foodRows.length === 0) return;
    const total = foodRows.reduce((sum, p) => sum + Number(p.amount), 0);
    if (
      !window.confirm(
        `Reclassify all ${foodRows.length} Food payments (${formatAmount(total.toFixed(2))} total) currently sitting on the wrong account, onto the Employee Food Expense account? Each is a separate reversal + repost.`,
      )
    ) {
      return;
    }
    setError(null);
    setBulkBusy(true);
    setBulkResult(null);
    try {
      const res = await apiClient.post<BulkResult>("/hr/employee-payments/bulk-reclassify-food");
      setBulkResult(res.data);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to bulk-reclassify Food payments");
    } finally {
      setBulkBusy(false);
    }
  }

  if (!isAdministrator) {
    return (
      <div className="card">
        <p>Only an Administrator can reclassify posted payments to a different account.</p>
      </div>
    );
  }

  if (!payments) return <p style={{ padding: 24 }}>Loading…</p>;

  return (
    <div className="intelligence-board">
      <Link to="/hr/employees/overview" className="intelligence-crumb">
        ← Back to Employees Overview
      </Link>
      {error && <div className="error-banner">{error}</div>}
      <div className="intelligence-panel-header">
        <div className="intelligence-panel-title">Reclassify misallocated payments</div>
      </div>
      <p style={{ color: "#98a2b3", fontSize: 13, marginTop: -8 }}>
        Allowance payments that were really Food, and Food payments still posted to the old pre-split account. Pick a
        new account per row and confirm, or fix every misallocated Food payment in one go below.
      </p>

      {foodRows.length > 0 && (
        <div className="card" style={{ marginBottom: 4 }}>
          <div className="form-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <span>
              <strong>{foodRows.length}</strong> Food payment{foodRows.length === 1 ? "" : "s"} (
              {formatAmount(foodRows.reduce((s, p) => s + Number(p.amount), 0).toFixed(2))}) still on the old account
            </span>
            <button onClick={bulkReclassifyFood} disabled={bulkBusy}>
              {bulkBusy ? "Working…" : "Reclassify all Food payments to Employee Food Expense"}
            </button>
          </div>
          {bulkResult && (
            <p style={{ color: "#027a48", marginTop: 8 }}>
              Reclassified {bulkResult.count} payment{bulkResult.count === 1 ? "" : "s"} — {formatAmount(bulkResult.totalAmount)} total.
            </p>
          )}
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Category</th>
            <th>Employee</th>
            <th>Amount</th>
            <th>Current account</th>
            <th>New account</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.paymentId}>
              <td>{new Date(p.paymentDate).toLocaleDateString()}</td>
              <td>{p.category === "ALLOWANCE" ? "Allowance" : "Food"}</td>
              <td>
                <Link to={`/hr/employees/${p.employeeId}`}>
                  {p.employeeCode} — {p.employeeName}
                </Link>
              </td>
              <td>{formatAmount(p.amount)}</td>
              <td>{p.currentAccountCode ? `${p.currentAccountCode} — ${p.currentAccountName}` : "—"}</td>
              <td>
                <select
                  value={selectedAccount[p.paymentId] ?? ""}
                  onChange={(e) => setSelectedAccount({ ...selectedAccount, [p.paymentId]: e.target.value })}
                >
                  <option value="">Select account…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <button
                  disabled={!selectedAccount[p.paymentId] || busyId === p.paymentId}
                  onClick={() => reclassify(p)}
                >
                  {busyId === p.paymentId ? "Working…" : "Reclassify"}
                </button>
              </td>
            </tr>
          ))}
          {payments.length === 0 && (
            <tr>
              <td colSpan={7} style={{ color: "#98a2b3" }}>
                No misallocated payments
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
