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

export function FinancialPositionLineDetailPage() {
  const { subClassCode } = useParams<{ subClassCode: string }>();
  const [searchParams] = useSearchParams();
  const asOfDate = searchParams.get("asOfDate") ?? "";
  const [data, setData] = useState<LineDetailReport | null>(null);

  useEffect(() => {
    if (!subClassCode || !asOfDate) return;
    apiClient
      .get<LineDetailReport>("/reports/financial-position/line-detail", { params: { subClassCode, asOfDate } })
      .then((res) => setData(res.data));
  }, [subClassCode, asOfDate]);

  if (!data) return <p style={{ padding: 24 }}>Loading…</p>;

  const transactionsHref = (accountId: string) =>
    `/accounts/${accountId}/transactions?asOfDate=${asOfDate}&back=${encodeURIComponent(
      `/financial-position/line/${subClassCode}?asOfDate=${asOfDate}`,
    )}`;

  return (
    <div className="intelligence-board">
      <Link to="/financial-position" className="intelligence-crumb">
        ← Back to Statement of Financial Position
      </Link>
      <div className="intelligence-panel-header">
        <div className="intelligence-panel-title">{data.label || subClassCode}</div>
        <div className="intelligence-total-pill">
          <div className="label">As of {asOfDate}</div>
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
        {data.accounts.length === 0 && <p style={{ color: "#98a2b3", padding: "16px 4px" }}>No balance recorded as of this date</p>}
      </div>
    </div>
  );
}
