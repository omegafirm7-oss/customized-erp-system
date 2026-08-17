import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { formatAmount } from "../utils/currency";

interface AllowancePayment {
  paymentId: string;
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

/**
 * Corrects a batch of ALLOWANCE-category payments that were really Food
 * expense, one at a time. Posted entries can't be silently edited (a DB
 * trigger blocks it, on purpose, for audit-trail integrity) — each
 * reclassify reverses the original entry and posts a new one on the
 * account you pick, identical in every other way. Administrator-only,
 * and every reclassify needs an explicit confirm before it runs.
 */
export function ReclassifyAllowancePaymentsPage() {
  const { user } = useAuth();
  const isAdministrator = user?.roleName === "Administrator";
  const [payments, setPayments] = useState<AllowancePayment[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiClient.get<AllowancePayment[]>("/hr/employee-payments/allowance").then((res) => setPayments(res.data));
  }

  useEffect(load, []);
  useEffect(() => {
    apiClient.get<Account[]>("/coa/accounts").then((res) => setAccounts(res.data.filter((a) => a.isPostable)));
  }, []);

  async function reclassify(p: AllowancePayment) {
    const targetId = selectedAccount[p.paymentId];
    if (!targetId) return;
    const target = accounts.find((a) => a.id === targetId);
    if (
      !window.confirm(
        `Reverse ${p.employeeCode} — ${p.employeeName}'s ${formatAmount(p.amount)} Allowance payment` +
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
        <div className="intelligence-panel-title">Reclassify Allowance payments</div>
      </div>
      <p style={{ color: "#98a2b3", fontSize: 13, marginTop: -8 }}>
        Every posted Allowance-category payment, with its current expense account. Pick a new account and confirm to correct it —
        each row is a separate reversal + repost, so you can move some to Food and leave others as genuine allowances.
      </p>
      <table>
        <thead>
          <tr>
            <th>Date</th>
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
              <td colSpan={6} style={{ color: "#98a2b3" }}>
                No posted Allowance payments
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
