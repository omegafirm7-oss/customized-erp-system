import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiClient } from "../api/client";
import { formatAmount } from "../utils/currency";

interface AccountTransactionRow {
  journalEntryId: string;
  entryNumber: string | null;
  postingDate: string;
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
  const [data, setData] = useState<AccountTransactionsReport | null>(null);

  useEffect(() => {
    if (!accountId) return;
    const params = asOfDate ? { asOfDate } : { fromDate, toDate };
    apiClient.get<AccountTransactionsReport>(`/reports/accounts/${accountId}/transactions`, { params }).then((res) => setData(res.data));
  }, [accountId, fromDate, toDate, asOfDate]);

  if (!data) return <p style={{ padding: 24 }}>Loading…</p>;

  return (
    <div className="intelligence-board">
      <Link to={back || "/trial-balance"} className="intelligence-crumb">
        ← Back
      </Link>
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
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Entry #</th>
            <th>Partner</th>
            <th>Description</th>
            <th>Debit</th>
            <th>Credit</th>
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
            </tr>
          ))}
          {data.transactions.length === 0 && (
            <tr>
              <td colSpan={6} style={{ color: "#98a2b3" }}>
                No transactions recorded for this period
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
