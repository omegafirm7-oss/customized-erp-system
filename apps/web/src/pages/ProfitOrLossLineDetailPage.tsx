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

const LINE_LABELS: Record<string, string> = {
  operatingRevenue: "Operating Revenue",
  costOfSales: "Cost of Sales",
  operatingExpense: "Operating Expenses",
  investingIncome: "Investing Income/(Expense)",
  financeCosts: "Finance Costs",
  taxExpense: "Tax Expense",
};

export function ProfitOrLossLineDetailPage() {
  const { line } = useParams<{ line: string }>();
  const [searchParams] = useSearchParams();
  const fromDate = searchParams.get("fromDate") ?? "";
  const toDate = searchParams.get("toDate") ?? "";
  const [data, setData] = useState<LineDetailReport | null>(null);

  useEffect(() => {
    if (!line || !fromDate || !toDate) return;
    apiClient
      .get<LineDetailReport>("/reports/profit-or-loss/line-detail", { params: { line, fromDate, toDate } })
      .then((res) => setData(res.data));
  }, [line, fromDate, toDate]);

  if (!data) return <p style={{ padding: 24 }}>Loading…</p>;

  const transactionsHref = (accountId: string) =>
    `/accounts/${accountId}/transactions?fromDate=${fromDate}&toDate=${toDate}&back=${encodeURIComponent(
      `/profit-or-loss/line/${line}?fromDate=${fromDate}&toDate=${toDate}`,
    )}`;

  return (
    <div className="intelligence-board">
      <Link to="/profit-or-loss" className="intelligence-crumb">
        ← Back to Statement of Profit or Loss
      </Link>
      <div className="intelligence-panel-header">
        <div className="intelligence-panel-title">{data.label || LINE_LABELS[line ?? ""] || line}</div>
        <div className="intelligence-total-pill">
          <div className="label">
            {fromDate} to {toDate}
          </div>
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
        {data.accounts.length === 0 && <p style={{ color: "#98a2b3", padding: "16px 4px" }}>No activity recorded for this period</p>}
      </div>
    </div>
  );
}
