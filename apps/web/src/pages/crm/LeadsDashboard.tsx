import { useEffect, useState } from "react";
import { apiClient } from "../../api/client";

export interface LeadsDashboardData {
  total: number;
  open: number;
  newThisMonth: number;
  newLastMonth: number;
  conversionRate: number;
  pipelineValue: number;
  followUpsDue: number;
  byStatus: Record<string, number>;
  bySource: Record<string, number>;
  byPriority: Record<string, number>;
  byService: Record<string, number>;
  topCities: { city: string; count: number }[];
  monthly: { month: string; count: number }[];
  sentLast30Days: Record<string, number>;
  recentActivity: {
    id: string;
    type: string;
    subject: string;
    sentAt: string | null;
    createdAt: string;
    lead: { id: string; name: string; companyName: string | null } | null;
  }[];
}

const STAGES = [
  { id: "NEW", label: "New" },
  { id: "CONTACTED", label: "Contacted" },
  { id: "QUALIFIED", label: "Qualified" },
  { id: "CONVERTED", label: "Converted" },
  { id: "DISQUALIFIED", label: "Disqualified" },
];

export const SOURCE_LABELS: Record<string, string> = {
  WEBSITE: "Website",
  REFERRAL: "Referral",
  COLD_CALL: "Cold call",
  EVENT: "Event",
  AI_RESEARCH: "AI research",
  OTHER: "Other",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Headline KPIs + pipeline/trend/source panels + recent activity for the Leads page. */
export function LeadsDashboard({ refreshKey, onStageClick }: { refreshKey: number; onStageClick: (status: string) => void }) {
  const [data, setData] = useState<LeadsDashboardData | null>(null);

  useEffect(() => {
    apiClient
      .get<LeadsDashboardData>("/crm/leads/dashboard")
      .then((res) => setData(res.data))
      .catch(() => setData(null));
  }, [refreshKey]);

  if (!data) return null;

  const trend = data.newThisMonth - data.newLastMonth;
  const whatsapp = data.sentLast30Days.WHATSAPP ?? 0;
  const email = data.sentLast30Days.EMAIL ?? 0;
  const stageMax = Math.max(1, ...STAGES.map((s) => data.byStatus[s.id] ?? 0));
  const monthMax = Math.max(1, ...data.monthly.map((m) => m.count));
  const sources = Object.entries(data.bySource).sort((a, b) => b[1] - a[1]);
  const sourceMax = Math.max(1, ...sources.map(([, n]) => n));

  return (
    <div className="crm-dash">
      <div className="crm-kpis">
        <div className="crm-kpi">
          <span className="crm-kpi-label">Total leads</span>
          <span className="crm-kpi-value">{data.total}</span>
          <span className={`crm-kpi-sub ${trend > 0 ? "up" : trend < 0 ? "down" : ""}`}>
            {data.newThisMonth} new this month
            {trend !== 0 && ` (${trend > 0 ? "+" : ""}${trend} vs last)`}
          </span>
        </div>
        <div className="crm-kpi">
          <span className="crm-kpi-label">Open pipeline</span>
          <span className="crm-kpi-value">{data.open}</span>
          <span className="crm-kpi-sub">
            {data.pipelineValue > 0 ? `SAR ${Math.round(data.pipelineValue).toLocaleString()} est. value` : "leads being worked"}
          </span>
        </div>
        <div className="crm-kpi">
          <span className="crm-kpi-label">Conversion rate</span>
          <span className="crm-kpi-value">{data.conversionRate}%</span>
          <span className="crm-kpi-sub">{data.byStatus.CONVERTED ?? 0} converted to opportunities</span>
        </div>
        <div className={`crm-kpi ${data.followUpsDue > 0 ? "alert" : ""}`}>
          <span className="crm-kpi-label">Follow-ups due</span>
          <span className="crm-kpi-value">{data.followUpsDue}</span>
          <span className="crm-kpi-sub">{data.followUpsDue > 0 ? "due today or overdue" : "all caught up"}</span>
        </div>
        <div className="crm-kpi">
          <span className="crm-kpi-label">Messages sent · 30 days</span>
          <span className="crm-kpi-value">{whatsapp + email}</span>
          <span className="crm-kpi-sub">
            {whatsapp} WhatsApp · {email} email
          </span>
        </div>
      </div>

      <div className="crm-panels">
        <section className="crm-panel">
          <header>
            <h4>Pipeline by stage</h4>
            <span className="crm-panel-note">click a stage to filter</span>
          </header>
          <div className="crm-hbars">
            {STAGES.map((s) => {
              const n = data.byStatus[s.id] ?? 0;
              return (
                <button type="button" key={s.id} className="crm-hbar-row" onClick={() => onStageClick(s.id)} title={`${s.label}: ${n} lead${n === 1 ? "" : "s"}`}>
                  <span className="crm-hbar-label">{s.label}</span>
                  <span className="crm-hbar-track">
                    <span className={`crm-hbar-fill stage-${s.id.toLowerCase()}`} style={{ width: `${(n / stageMax) * 100}%` }} />
                  </span>
                  <span className="crm-hbar-value">{n}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="crm-panel">
          <header>
            <h4>New leads · last 6 months</h4>
          </header>
          <div className="crm-columns" role="img" aria-label={data.monthly.map((m) => `${m.month}: ${m.count}`).join(", ")}>
            {data.monthly.map((m) => {
              const label = MONTHS[Number(m.month.slice(5, 7)) - 1];
              return (
                <div key={m.month} className="crm-col" title={`${label} ${m.month.slice(0, 4)}: ${m.count} new lead${m.count === 1 ? "" : "s"}`}>
                  <span className="crm-col-value">{m.count > 0 ? m.count : ""}</span>
                  <span className="crm-col-track">
                    <span className="crm-col-fill" style={{ height: `${(m.count / monthMax) * 100}%` }} />
                  </span>
                  <span className="crm-col-label">{label}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="crm-panel">
          <header>
            <h4>Lead sources</h4>
          </header>
          {sources.length === 0 ? (
            <p className="crm-empty">No leads yet</p>
          ) : (
            <div className="crm-hbars">
              {sources.map(([src, n]) => (
                <div key={src} className="crm-hbar-row static" title={`${SOURCE_LABELS[src] ?? src}: ${n}`}>
                  <span className="crm-hbar-label">{SOURCE_LABELS[src] ?? src}</span>
                  <span className="crm-hbar-track">
                    <span className="crm-hbar-fill" style={{ width: `${(n / sourceMax) * 100}%` }} />
                  </span>
                  <span className="crm-hbar-value">{n}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="crm-panel">
          <header>
            <h4>Recent activity</h4>
          </header>
          {data.recentActivity.length === 0 ? (
            <p className="crm-empty">No messages or activities yet</p>
          ) : (
            <ul className="crm-feed">
              {data.recentActivity.map((a) => (
                <li key={a.id}>
                  <span className={`crm-feed-icon t-${a.type.toLowerCase()}`}>{a.type === "WHATSAPP" ? "WA" : a.type.slice(0, 2)}</span>
                  <span className="crm-feed-text">
                    <strong>{a.lead?.companyName ?? a.lead?.name ?? "Lead"}</strong>
                    <span>{a.type === "WHATSAPP" ? "WhatsApp message" : a.type === "EMAIL" ? "Email sent" : a.subject}</span>
                  </span>
                  <span className="crm-feed-time">{relativeTime(a.sentAt ?? a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
