import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiClient } from "../api/client";

interface Partner {
  id: string;
  code: string;
  name: string;
  partnerType: string;
  taxRegistrationNumber: string | null;
}

interface InvoiceRow {
  id: string;
  invoiceNumber: string | null;
  vendorInvoiceNumber?: string;
  status: string;
  postingDate: string;
  grossTotal: string;
  openAmount: string;
  lines?: Array<{
    expenseAccount?: { code: string; name: string } | null;
    costCenter?: { code: string; name: string } | null;
  }>;
}

function accountSummary(inv: InvoiceRow): string {
  const acct = inv.lines?.[0]?.expenseAccount;
  return acct ? `${acct.code} ${acct.name}` : "—";
}
function costCenterSummary(inv: InvoiceRow): string {
  const cc = inv.lines?.[0]?.costCenter;
  return cc ? cc.code : "—";
}

export function PartnerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [partner, setPartner] = useState<Partner | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [partnerRes, invoicesRes] = await Promise.all([
      apiClient.get<Partner>(`/partners/${id}`),
      apiClient.get<InvoiceRow[]>("/ap/invoices", { params: { partnerId: id } }),
    ]);
    setPartner(partnerRes.data);
    setInvoices(invoicesRes.data);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(invoiceId: string) {
    setError(null);
    setBusyId(invoiceId);
    try {
      await apiClient.delete(`/ap/invoices/${invoiceId}`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to delete draft");
    } finally {
      setBusyId(null);
    }
  }

  async function post(invoiceId: string) {
    setError(null);
    setBusyId(invoiceId);
    try {
      await apiClient.post(`/ap/invoices/${invoiceId}/post`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to post invoice");
    } finally {
      setBusyId(null);
    }
  }

  // Draft invoices have no AP liability booked yet — openAmount defaults to 0
  // until posting, so treating (gross-open) as "paid" for a draft would show
  // every unposted expense as fully paid. Paid/pending are only meaningful
  // once an invoice is posted (POSTED/PARTIALLY_PAID/PAID); drafts are
  // tracked separately as "not yet posted".
  function summarize(rows: InvoiceRow[]) {
    return rows.reduce(
      (acc, inv) => {
        if (inv.status === "CANCELLED") return acc;
        const gross = Number(inv.grossTotal);
        if (inv.status === "DRAFT") {
          return { ...acc, gross: acc.gross + gross, draft: acc.draft + gross };
        }
        const open = Number(inv.openAmount);
        return { ...acc, gross: acc.gross + gross, paid: acc.paid + (gross - open), pending: acc.pending + open };
      },
      { gross: 0, paid: 0, pending: 0, draft: 0 },
    );
  }

  const overall = useMemo(() => summarize(invoices), [invoices]);

  const byPeriod = useMemo(() => {
    const groups = new Map<string, InvoiceRow[]>();
    for (const inv of invoices) {
      const key = inv.postingDate.slice(0, 7); // YYYY-MM
      const list = groups.get(key) ?? [];
      list.push(inv);
      groups.set(key, list);
    }
    return [...groups.entries()].map(([period, rows]) => [period, summarize(rows)] as const).sort((a, b) => b[0].localeCompare(a[0]));
  }, [invoices]);

  if (loading || !partner) {
    return <div className="card">Loading…</div>;
  }

  return (
    <div>
      <div className="card">
        <h2>
          {partner.code} — {partner.name}
        </h2>
        <p style={{ color: "#667085" }}>VAT/TRN: {partner.taxRegistrationNumber ?? "—"}</p>
        <div className="form-row">
          <div className="kpi-tile">
            <div>Overall (gross)</div>
            <strong>{overall.gross.toFixed(2)}</strong>
          </div>
          <div className="kpi-tile">
            <div>Paid</div>
            <strong>{overall.paid.toFixed(2)}</strong>
          </div>
          <div className="kpi-tile">
            <div>Pending (posted, unpaid)</div>
            <strong>{overall.pending.toFixed(2)}</strong>
          </div>
          <div className="kpi-tile">
            <div>Not yet posted (draft)</div>
            <strong>{overall.draft.toFixed(2)}</strong>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Period-wise</h3>
        <table>
          <thead>
            <tr>
              <th>Period</th>
              <th>Gross</th>
              <th>Paid</th>
              <th>Pending</th>
              <th>Draft</th>
            </tr>
          </thead>
          <tbody>
            {byPeriod.map(([period, totals]) => (
              <tr key={period}>
                <td>{period}</td>
                <td>{totals.gross.toFixed(2)}</td>
                <td>{totals.paid.toFixed(2)}</td>
                <td>{totals.pending.toFixed(2)}</td>
                <td>{totals.draft.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>All invoices</h3>
        {error && <div className="error-banner">{error}</div>}
        <table>
          <thead>
            <tr>
              <th>Number</th>
              <th>Vendor Ref</th>
              <th>Account</th>
              <th>Project</th>
              <th>Posting Date</th>
              <th>Gross</th>
              <th>Open</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td>{inv.invoiceNumber ?? "—"}</td>
                <td>{inv.vendorInvoiceNumber}</td>
                <td>{accountSummary(inv)}</td>
                <td>{costCenterSummary(inv)}</td>
                <td>{new Date(inv.postingDate).toLocaleDateString()}</td>
                <td>{Number(inv.grossTotal).toFixed(2)}</td>
                <td>{Number(inv.openAmount).toFixed(2)}</td>
                <td>
                  <span className={`badge ${inv.status === "DRAFT" ? "draft" : inv.status === "CANCELLED" ? "reversed" : "posted"}`}>
                    {inv.status.replace("_", " ")}
                  </span>
                </td>
                <td>
                  {inv.status === "DRAFT" && (
                    <>
                      <button disabled={busyId === inv.id} onClick={() => post(inv.id)}>
                        Post
                      </button>{" "}
                      <Link to={`/ap/invoices/${inv.id}/edit`}>
                        <button type="button" className="secondary" disabled={busyId === inv.id}>
                          Edit
                        </button>
                      </Link>{" "}
                      <button className="danger" disabled={busyId === inv.id} onClick={() => remove(inv.id)}>
                        Delete
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
