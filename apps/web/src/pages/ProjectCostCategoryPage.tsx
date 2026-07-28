import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiClient } from "../api/client";

interface IntelligenceAccount {
  id: string;
  code: string;
  name: string;
  amount: string;
}

interface Intelligence {
  categories: Record<"MATERIAL" | "MACHINERY" | "LABOR" | "OTHER", { total: string; accounts: IntelligenceAccount[] }>;
  grandTotal: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  MATERIAL: "Material",
  MACHINERY: "Machinery",
  LABOR: "Labor",
  OTHER: "Other",
};

const CATEGORY_ICONS: Record<string, string> = {
  MATERIAL: "\u{1F4E6}",
  MACHINERY: "\u{1F69C}",
  LABOR: "\u{1F477}",
  OTHER: "\u{1F4CB}",
};

export function ProjectCostCategoryPage() {
  const { id, category } = useParams<{ id: string; category: string }>();
  const [data, setData] = useState<Intelligence | null>(null);

  useEffect(() => {
    if (!id) return;
    apiClient.get<Intelligence>(`/projects/${id}/intelligence`).then((res) => setData(res.data));
  }, [id]);

  if (!data || !category) return <p style={{ padding: 24 }}>Loading…</p>;

  const key = category.toUpperCase() as keyof Intelligence["categories"];
  const bucket = data.categories[key];
  const isLabor = key === "LABOR";

  return (
    <div className="intelligence-board">
      <Link to={`/projects/${id}`} className="intelligence-crumb">
        ← Back to project
      </Link>
      <div className="intelligence-panel-header">
        <div className="intelligence-panel-title">
          <span style={{ fontSize: 28 }}>{CATEGORY_ICONS[key] ?? ""}</span>
          {CATEGORY_LABELS[key] ?? key} costs
        </div>
        <div className="intelligence-total-pill">
          <div className="label">Category total</div>
          <div className="value">{Number(bucket?.total ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </div>
      </div>
      <div className="intelligence-account-grid">
        {(bucket?.accounts ?? []).map((a) => (
          <Link
            key={a.id}
            to={isLabor ? `/projects/${id}/costs/labor?accountId=${a.id}` : `/projects/${id}/costs/accounts/${a.id}`}
            style={{ textDecoration: "none" }}
          >
            <div className="intelligence-account-card">
              <div className="code">{a.code}</div>
              <div className="name">{a.name}</div>
              <div className="amount">{Number(a.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <div className="arrow">View detail →</div>
            </div>
          </Link>
        ))}
        {(!bucket || bucket.accounts.length === 0) && (
          <p style={{ color: "#98a2b3", padding: "16px 4px" }}>No costs recorded yet</p>
        )}
      </div>
    </div>
  );
}
