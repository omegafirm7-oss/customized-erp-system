import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../api/client";

interface Dashboard {
  today: string;
  kpis: {
    revenueToday: string;
    revenueSameDayLastWeek: string;
    billsToday: number;
    returnsToday: number;
    averageBill: string;
    cashToday: string;
    cardToday: string;
  };
  days: Array<{ date: string; treatments: string; products: string }>;
  fbr: {
    enabled: boolean;
    environment: "MOCK" | "SANDBOX" | "PRODUCTION" | null;
    lastAcknowledgedAt: string | null;
    today: { total: number; accepted: number; pending: number; rejected: number; notReported: number };
  };
  monthTax: { services: string; goods: string; furtherTax: string; posFees: string; total: string };
  recentSales: Array<{
    id: string;
    invoiceNumber: string | null;
    dateTime: string;
    patient: string;
    items: string;
    amount: string;
    isReturn: boolean;
    fbrStatus: "VALID" | "PENDING" | "INVALID" | "FAILED" | null;
    fbrInvoiceNumber: string | null;
  }>;
  topTreatments: Array<{ name: string; quantity: string; amount: string }>;
}

const FONT_HREF = "https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Manrope:wght@400;500;600;700&display=swap";

function rs(value: string | number, digits = 0) {
  return `Rs. ${Number(value).toLocaleString("en-PK", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function compact(value: string | number) {
  const n = Number(value);
  if (Math.abs(n) >= 1_000_000) return `Rs. ${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `Rs. ${(n / 1_000).toFixed(0)}k`;
  return rs(n);
}

function greeting() {
  const hour = Number(new Date(Date.now() + 5 * 3600_000).toISOString().slice(11, 13));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

function minutesAgo(iso: string | null) {
  if (!iso) return "no sales reported yet";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "last sale reported just now";
  if (mins < 60) return `last sale reported ${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `last sale reported ${hours} h ago` : `last sale reported ${new Date(iso).toLocaleDateString("en-PK")}`;
}

const FBR_BADGE: Record<string, { label: string; className: string }> = {
  VALID: { label: "Accepted", className: "cd-badge ok" },
  PENDING: { label: "Waiting", className: "cd-badge wait" },
  INVALID: { label: "Rejected", className: "cd-badge bad" },
  FAILED: { label: "Token issue", className: "cd-badge bad" },
};

export function ClinicDashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [company, setCompany] = useState<{ legalName: string; tradeName: string | null; city: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!document.querySelector(`link[href="${FONT_HREF}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = FONT_HREF;
      document.head.appendChild(link);
    }
    const load = () =>
      apiClient
        .get<Dashboard>("/pos/dashboard")
        .then((res) => setData(res.data))
        .catch((err) => setError(err?.response?.data?.message ?? "Failed to load the dashboard"));
    load();
    apiClient.get("/companies/current").then((res) => setCompany(res.data)).catch(() => undefined);
    // Keep the counter numbers fresh while the dashboard is left open.
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, []);

  if (error) return <div className="card"><div className="error-banner">{error}</div></div>;
  if (!data) return <div className="card">Loading dashboard…</div>;

  const { kpis, fbr } = data;
  const change = Number(kpis.revenueSameDayLastWeek) > 0 ? ((Number(kpis.revenueToday) - Number(kpis.revenueSameDayLastWeek)) / Number(kpis.revenueSameDayLastWeek)) * 100 : null;
  const maxDay = Math.max(1, ...data.days.map((d) => Math.max(0, Number(d.treatments)) + Math.max(0, Number(d.products))));
  const topMax = Math.max(1, ...data.topTreatments.map((t) => Number(t.amount)));
  const acceptedPct = fbr.today.total ? (fbr.today.accepted / fbr.today.total) * 100 : 0;
  const pendingPct = fbr.today.total ? (fbr.today.pending / fbr.today.total) * 100 : 0;
  const todayLabel = new Date(`${data.today}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const displayName = company?.tradeName || company?.legalName || "";

  return (
    <div className="cd">
      <header className="cd-header">
        <div>
          <div className="cd-muted">{todayLabel}{displayName ? ` · ${displayName}` : ""}</div>
          <h1 className="cd-title">{greeting()}</h1>
        </div>
        <div className="cd-actions">
          {fbr.environment && fbr.environment !== "PRODUCTION" && (
            <span className="cd-pill" title="Sales are not legally reported until FBR is switched to Production">
              FBR {fbr.environment === "MOCK" ? "test mode" : "sandbox"}
            </span>
          )}
          <Link to="/pos/counter" className="cd-primary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            New sale
          </Link>
        </div>
      </header>

      <section className="cd-kpis" aria-label="Today at a glance">
        <div className="cd-card">
          <div className="cd-label">Revenue today</div>
          <div className="cd-value">{rs(kpis.revenueToday)}</div>
          <div className={`cd-note ${change !== null && change >= 0 ? "up" : change !== null ? "down" : ""}`}>
            {change === null ? "No sales on the same day last week" : `${change >= 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(0)}% vs last ${new Date(`${data.today}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })}`}
          </div>
        </div>
        <div className="cd-card">
          <div className="cd-label">Bills today</div>
          <div className="cd-value">{kpis.billsToday}</div>
          <div className="cd-note">{kpis.returnsToday ? `${kpis.returnsToday} return${kpis.returnsToday === 1 ? "" : "s"}` : "No returns"}</div>
        </div>
        <div className="cd-card">
          <div className="cd-label">Average bill</div>
          <div className="cd-value">{rs(kpis.averageBill)}</div>
          <div className="cd-note">Incl. sales tax</div>
        </div>
        <div className="cd-card">
          <div className="cd-label">Cash · Card today</div>
          <div className="cd-value cd-value-sm">{rs(kpis.cashToday)}<span className="cd-sep">·</span>{rs(kpis.cardToday)}</div>
          <div className="cd-note">Match against the till and card machine</div>
        </div>
      </section>

      <section className="cd-row">
        <div className="cd-card cd-span2">
          <div className="cd-card-head">
            <h2>Revenue, last 14 days</h2>
            <div className="cd-legend">
              <span><i className="sw treat" />Treatments</span>
              <span><i className="sw prod" />Products</span>
            </div>
          </div>
          <div className="cd-bars" role="img" aria-label="Daily revenue for the last 14 days, split into treatments and products">
            {data.days.map((d) => {
              const t = Math.max(0, Number(d.treatments));
              const p = Math.max(0, Number(d.products));
              return (
                <div key={d.date} className="cd-bar" title={`${d.date}: treatments ${rs(t)}, products ${rs(p)}`}>
                  <div className="prod" style={{ height: `${(p / maxDay) * 200}px` }} />
                  <div className="treat" style={{ height: `${(t / maxDay) * 200}px` }} />
                </div>
              );
            })}
          </div>
          <div className="cd-bar-labels">
            {data.days.map((d) => (
              <span key={d.date}>{Number(d.date.slice(8))}</span>
            ))}
          </div>
        </div>

        <div className="cd-card cd-dark">
          <div className="cd-card-head">
            <h2>FBR reporting · today</h2>
            <span className={`cd-dot ${fbr.enabled ? "on" : "off"}`} aria-hidden="true" />
          </div>
          {fbr.enabled ? (
            <>
              <div className="cd-fbr-big">
                {fbr.today.accepted}<span>/{fbr.today.total}</span>
                <small>sales accepted by FBR</small>
              </div>
              <div className="cd-progress" aria-hidden="true">
                <div className="ok" style={{ width: `${acceptedPct}%` }} />
                <div className="wait" style={{ width: `${pendingPct}%` }} />
              </div>
              <dl className="cd-fbr-list">
                <div><dt>Accepted</dt><dd>{fbr.today.accepted}</dd></div>
                <div><dt>Waiting (auto-retry)</dt><dd className={fbr.today.pending ? "warn" : ""}>{fbr.today.pending}</dd></div>
                <div><dt>Rejected — needs attention</dt><dd className={fbr.today.rejected ? "warn" : ""}>{fbr.today.rejected}</dd></div>
              </dl>
              <div className="cd-muted-dark">{minutesAgo(fbr.lastAcknowledgedAt)}</div>
              {fbr.today.rejected > 0 && <Link to="/fbr/submissions?status=INVALID" className="cd-link-dark">Fix rejected sales →</Link>}
            </>
          ) : (
            <p className="cd-muted-dark">FBR reporting is switched off. <Link to="/fbr/settings" className="cd-link-dark">Open FBR Settings</Link></p>
          )}
          <div className="cd-tax">
            <div className="cd-muted-dark">Sales tax collected this month</div>
            <div className="cd-tax-total">{rs(data.monthTax.total)}</div>
            <div className="cd-muted-dark">
              Services {rs(data.monthTax.services)} · Goods {rs(data.monthTax.goods)}
              {Number(data.monthTax.furtherTax) ? ` · Further tax ${rs(data.monthTax.furtherTax)}` : ""} · POS fees {rs(data.monthTax.posFees)}
            </div>
          </div>
        </div>
      </section>

      <section className="cd-row">
        <div className="cd-card cd-span2">
          <div className="cd-card-head">
            <h2>Recent sales</h2>
            <Link to="/fbr/submissions">All sales →</Link>
          </div>
          {data.recentSales.length === 0 ? (
            <p className="cd-muted">No sales yet. They appear here as soon as the counter records them.</p>
          ) : (
            <div className="cd-table-wrap">
              <table className="cd-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Patient</th>
                    <th>Items</th>
                    <th className="r">Amount</th>
                    <th>FBR</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentSales.map((s) => {
                    const badge = s.fbrStatus ? FBR_BADGE[s.fbrStatus] : null;
                    return (
                      <tr key={s.id}>
                        <td className="cd-muted">{new Date(s.dateTime).toLocaleTimeString("en-PK", { hour: "numeric", minute: "2-digit" })}</td>
                        <td className="b">{s.patient}{s.isReturn && <span className="cd-badge bad" style={{ marginLeft: 6 }}>refund</span>}</td>
                        <td className="cd-items">{s.items}</td>
                        <td className="r b">{s.isReturn ? "−" : ""}{rs(Math.abs(Number(s.amount)))}</td>
                        <td>{badge ? <span className={badge.className} title={s.fbrInvoiceNumber ?? undefined}>{badge.label}</span> : <span className="cd-muted">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="cd-card">
          <div className="cd-card-head">
            <h2>Top treatments · this month</h2>
          </div>
          {data.topTreatments.length === 0 ? (
            <p className="cd-muted">No treatments sold this month yet.</p>
          ) : (
            <div className="cd-top">
              {data.topTreatments.map((t) => (
                <div key={t.name}>
                  <div className="cd-top-row">
                    <span className="b">{t.name}</span>
                    <span className="cd-muted">{Number(t.quantity)} · <b>{compact(t.amount)}</b></span>
                  </div>
                  <div className="cd-track"><div style={{ width: `${(Number(t.amount) / topMax) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
