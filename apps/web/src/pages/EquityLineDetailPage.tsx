import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiClient } from "../api/client";
import { formatSigned } from "../utils/currency";

interface LineDetailAccount {
  accountId: string;
  code: string;
  name: string;
  amount: string;
}

interface LineDetailReport {
  label: string;
  total: string;
  accounts: LineDetailAccount[];
}

const COLUMN_LABELS: Record<string, string> = {
  opening: "Opening Balance",
  otherMovements: "Other Movements",
};

export function EquityLineDetailPage() {
  const { subClassCode, column } = useParams<{ subClassCode: string; column: string }>();
  const [searchParams] = useSearchParams();
  const fromDate = searchParams.get("fromDate") ?? "";
  const toDate = searchParams.get("toDate") ?? "";
  const [data, setData] = useState<LineDetailReport | null>(null);

  useEffect(() => {
    if (!subClassCode || !column || !fromDate || !toDate) return;
    apiClient
      .get<LineDetailReport>("/reports/changes-in-equity/line-detail", { params: { subClassCode, column, fromDate, toDate } })
      .then((res) => setData(res.data));
  }, [subClassCode, column, fromDate, toDate]);

  if (!data) return <p style={{ padding: 24 }}>Loading…</p>;

  // "Opening" is everything posted before the period started — accountTransactions
  // needs an explicit range covering all prior history, not the report's own
  // fromDate/toDate (that's the *period's* movements, a different question).
  const isOpening = column === "opening";
  const transactionsFrom = isOpening ? "1900-01-01" : fromDate;
  const transactionsTo = isOpening ? new Date(new Date(fromDate).getTime() - 86400000).toISOString().slice(0, 10) : toDate;

  const transactionsHref = (accountId: string) =>
    `/accounts/${accountId}/transactions?fromDate=${transactionsFrom}&toDate=${transactionsTo}&back=${encodeURIComponent(
      `/changes-in-equity/line/${subClassCode}/${column}?fromDate=${fromDate}&toDate=${toDate}`,
    )}`;

  return (
    <div className="intelligence-board">
      <Link to="/changes-in-equity" className="intelligence-crumb">
        ← Back to Statement of Changes in Equity
      </Link>
      <div className="intelligence-panel-header">
        <div className="intelligence-panel-title">
          {data.label} — {COLUMN_LABELS[column ?? ""] ?? column}
        </div>
        <div className="intelligence-total-pill">
          <div className="label">{isOpening ? `Before ${fromDate}` : `${fromDate} to ${toDate}`}</div>
          <div className="value">{formatSigned(data.total)}</div>
        </div>
      </div>
      <div className="intelligence-account-grid">
        {data.accounts.map((a) => (
          <Link key={a.accountId} to={transactionsHref(a.accountId)} style={{ textDecoration: "none" }}>
            <div className="intelligence-account-card">
              <div className="code">{a.code}</div>
              <div className="name">{a.name}</div>
              <div className="amount">{formatSigned(a.amount)}</div>
              <div className="arrow">View transactions →</div>
            </div>
          </Link>
        ))}
        {data.accounts.length === 0 && <p style={{ color: "#98a2b3", padding: "16px 4px" }}>No activity recorded</p>}
      </div>
    </div>
  );
}
