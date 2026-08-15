import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiClient } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { formatAmount } from "../utils/currency";

interface AccountTransactionRow {
  journalEntryId: string;
  entryNumber: string | null;
  postingDate: string;
  status: string;
  memo: string | null;
  lineDescription: string | null;
  partnerName: string | null;
  debit: string;
  credit: string;
}

interface AccountTransactionsReport {
  accountId: string;
  accountCode: string;
  accountName: string;
  totalDebit: string;
  totalCredit: string;
  transactions: AccountTransactionRow[];
}

export function AccountTransactionsPage() {
  const { accountId } = useParams<{ accountId: string }>();
  const [searchParams] = useSearchParams();
  const fromDate = searchParams.get("fromDate");
  const toDate = searchParams.get("toDate");
  const asOfDate = searchParams.get("asOfDate");
  const back = searchParams.get("back");
  const { user } = useAuth();
  const isAdministrator = user?.roleName === "Administrator";
  const [data, setData] = useState<AccountTransactionsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reversingId, setReversingId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!accountId) return;
    const params = asOfDate ? { asOfDate } : { fromDate, toDate };
    apiClient.get<AccountTransactionsReport>(`/reports/accounts/${accountId}/transactions`, { params }).then((res) => setData(res.data));
  }, [accountId, fromDate, toDate, asOfDate]);

  useEffect(load, [load]);

  async function handleReverse(journalEntryId: string) {
    if (
      !window.confirm(
        "Reverse this journal entry? Posted entries can't be edited directly — this creates an offsetting reversal entry, which is the correct way to fix a mistake. You can then post a new corrected entry.",
      )
    ) {
      return;
    }
    setError(null);
    setReversingId(journalEntryId);
    try {
      await apiClient.post(`/gl/journal-entries/${journalEntryId}/reverse`);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to reverse entry");
    } finally {
      setReversingId(null);
    }
  }

  if (!data) return <p style={{ padding: 24 }}>Loading…</p>;

  return (
    <div className="intelligence-board">
      <Link to={back || "/trial-balance"} className="intelligence-crumb">
        ← Back
      </Link>
      {error && <div className="error-banner">{error}</div>}
      <div className="intelligence-panel-header">
        <div className="intelligence-panel-title">
          {data.accountCode} — {data.accountName}
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div className="intelligence-total-pill">
            <div className="label">Debit</div>
            <div className="value">{formatAmount(data.totalDebit)}</div>
          </div>
          <div className="intelligence-total-pill">
            <div className="label">Credit</div>
            <div className="value">{formatAmount(data.totalCredit)}</div>
          </div>
        </div>
      </div>
      {isAdministrator && (
        <p style={{ color: "#98a2b3", fontSize: 13, marginTop: -8 }}>
          Posted entries are permanent (required for audit trail) and can't be edited directly. As Administrator you can reverse a
          wrong entry below, then post a new corrected one from Journal Entries.
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Entry #</th>
            <th>Partner</th>
            <th>Description</th>
            <th>Debit</th>
            <th>Credit</th>
            <th>Status</th>
            {isAdministrator && <th>Correction</th>}
          </tr>
        </thead>
        <tbody>
          {data.transactions.map((t) => (
            <tr key={t.journalEntryId + t.postingDate + t.debit + t.credit}>
              <td>{new Date(t.postingDate).toLocaleDateString()}</td>
              <td>{t.entryNumber ?? "—"}</td>
              <td>{t.partnerName ?? "—"}</td>
              <td>{t.lineDescription ?? t.memo ?? "—"}</td>
              <td>{Number(t.debit) !== 0 ? formatAmount(t.debit) : ""}</td>
              <td>{Number(t.credit) !== 0 ? formatAmount(t.credit) : ""}</td>
              <td>
                <span className={`badge ${t.status === "REVERSED" ? "reversed" : "posted"}`}>{t.status}</span>
              </td>
              {isAdministrator && (
                <td>
                  {t.status === "POSTED" && (
                    <button className="secondary" disabled={reversingId === t.journalEntryId} onClick={() => handleReverse(t.journalEntryId)}>
                      {reversingId === t.journalEntryId ? "Reversing…" : "Reverse"}
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
          {data.transactions.length === 0 && (
            <tr>
              <td colSpan={isAdministrator ? 8 : 7} style={{ color: "#98a2b3" }}>
                No transactions recorded for this period
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
