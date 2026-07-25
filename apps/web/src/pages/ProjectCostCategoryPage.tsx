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
    <div className="card">
      <p>
        <Link to={`/projects/${id}`}>← Back to project</Link>
      </p>
      <h2>{CATEGORY_LABELS[key] ?? key} costs</h2>
      <div className="kpi-tile" style={{ maxWidth: 220 }}>
        <div>Total</div>
        <strong>{Number(bucket?.total ?? 0).toFixed(2)}</strong>
      </div>
      <table>
        <thead>
          <tr>
            <th>Account</th>
            <th>Amount</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {(bucket?.accounts ?? []).map((a) => (
            <tr key={a.id}>
              <td>
                {a.code} — {a.name}
              </td>
              <td>{Number(a.amount).toFixed(2)}</td>
              <td>
                <Link to={isLabor ? `/projects/${id}/costs/labor` : `/projects/${id}/costs/accounts/${a.id}`}>
                  View detail →
                </Link>
              </td>
            </tr>
          ))}
          {(!bucket || bucket.accounts.length === 0) && (
            <tr>
              <td colSpan={3} style={{ color: "#98a2b3" }}>
                No costs recorded yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
