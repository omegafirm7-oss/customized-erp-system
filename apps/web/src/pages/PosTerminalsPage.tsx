import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiClient } from "../api/client";

interface Terminal {
  id: string;
  code: string;
  name: string;
  fbrPosId: number;
  warehouseId: string | null;
  costCenterId: string | null;
  walkInPartnerId: string;
  cashAccountId: string;
  cardAccountId: string | null;
  apiKeyPrefix: string;
  isActive: boolean;
  lastUsedAt: string | null;
}

interface DailyRow {
  terminal: Terminal;
  transactions: number;
  netSales: string;
  posFees: string;
  fbrAcknowledged: number;
  fbrAcknowledgedAmount: string;
  fbrOutstanding: number;
}

interface Option {
  id: string;
  code: string;
  name: string;
}

const EMPTY_FORM = { code: "", name: "", fbrPosId: "", walkInPartnerId: "", cashAccountId: "", cardAccountId: "", warehouseId: "", costCenterId: "" };

/** Pakistan-local calendar date (UTC+5). */
function pkToday() {
  return new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
}

const SAMPLE_SALE = `POST ${window.location.origin}/api/pos/v1/sales
X-POS-Key: <terminal key>
Content-Type: application/json

{
  "clientSaleId": "TILL1-000123",        // your unique id; resending is safe
  "dateTime": "2026-09-24T14:05:00+05:00",
  "paymentMode": 1,                       // 1 cash, 2 card, 3 gift voucher, 4 loyalty, 5 mixed, 6 cheque
  "pricesIncludeTax": true,
  "buyer": { "name": "Ali Raza", "ntnCnic": "3520212345671", "phone": "03001234567" },
  "lines": [
    { "itemCode": "FAN-01", "quantity": "2", "unitPrice": "11800.00", "discountAmount": "0" }
  ]
}`;

const SAMPLE_RESPONSE = `{
  "clientSaleId": "TILL1-000123",
  "type": "SALE",
  "erpInvoiceNumber": "INV-000123",
  "usin": "INV-000123",
  "fbr": {
    "status": "VALID",                   // PENDING if FBR was unreachable — poll GET /api/pos/v1/sales/{clientSaleId}
    "invoiceNumber": "812345240924140500123",
    "qrPayload": "812345240924140500123" // print as QR (1" x 1") with the FBR POS logo
  },
  "totals": { "saleValue": "20000", "salesTax": "3600", "furtherTax": "0",
              "total": "23600", "posFee": "1", "amountPayable": "23601" }
}`;

const SAMPLE_RETURN = `POST ${window.location.origin}/api/pos/v1/sales/TILL1-000123/returns
X-POS-Key: <terminal key>

{ "clientSaleId": "TILL1-R-000007", "lines": [ { "itemCode": "FAN-01", "quantity": "1" } ] }`;

export function PosTerminalsPage() {
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [date, setDate] = useState(pkToday());
  const [customers, setCustomers] = useState<Option[]>([]);
  const [cashAccounts, setCashAccounts] = useState<Option[]>([]);
  const [warehouses, setWarehouses] = useState<Option[]>([]);
  const [costCenters, setCostCenters] = useState<Option[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [revealed, setRevealed] = useState<{ code: string; apiKey: string } | null>(null);
  const [showDocs, setShowDocs] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [t, d] = await Promise.all([
      apiClient.get<Terminal[]>("/pos/terminals"),
      apiClient.get<DailyRow[]>(`/pos/terminals/daily-summary?date=${date}`),
    ]);
    setTerminals(t.data);
    setDaily(d.data);
  }, [date]);

  useEffect(() => {
    load().catch((err) => setError(err?.response?.data?.message ?? "Failed to load POS terminals"));
  }, [load]);

  useEffect(() => {
    Promise.all([
      apiClient.get("/partners"),
      apiClient.get("/coa/accounts"),
      apiClient.get("/warehouses"),
      apiClient.get("/cost-centers").catch(() => ({ data: [] })),
    ])
      .then(([p, a, w, c]) => {
        setCustomers(p.data.filter((x: any) => x.isActive && x.partnerType !== "VENDOR"));
        setCashAccounts(a.data.filter((x: any) => x.isPostable && (x.controlAccountType === "CASH" || x.controlAccountType === "BANK")));
        setWarehouses(w.data.filter((x: any) => x.isActive));
        setCostCenters(c.data.filter((x: any) => x.isActive !== false));
      })
      .catch(() => undefined);
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const body = Object.fromEntries(Object.entries({ ...form, fbrPosId: Number(form.fbrPosId) }).filter(([, v]) => v !== ""));
      const res = await apiClient.post("/pos/terminals", body);
      setRevealed({ code: res.data.code, apiKey: res.data.apiKey });
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch (err: any) {
      const m = err?.response?.data?.message;
      setError(Array.isArray(m) ? m.join("; ") : m ?? "Failed to create terminal");
    }
  }

  async function rotate(terminal: Terminal) {
    if (!window.confirm(`Issue a new key for ${terminal.code}? The current key stops working immediately.`)) return;
    setError(null);
    try {
      const res = await apiClient.post(`/pos/terminals/${terminal.id}/rotate-key`);
      setRevealed({ code: terminal.code, apiKey: res.data.apiKey });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to rotate key");
    }
  }

  async function toggleActive(terminal: Terminal) {
    setError(null);
    try {
      await apiClient.patch(`/pos/terminals/${terminal.id}`, { isActive: !terminal.isActive });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to update terminal");
    }
  }

  const nameOf = (list: Option[], id: string | null) => {
    const found = list.find((o) => o.id === id);
    return found ? `${found.code} ${found.name}` : "—";
  };

  return (
    <div>
      <div className="card">
        <h2>POS Terminals</h2>
        <p className="muted">
          Each till registered with FBR (IRIS → POS registration → POSID) sends its sales here with its own API key.
          Each sale is posted as a paid sales invoice, reported to FBR's POS system, and the FBR invoice number comes back
          to the till for the receipt.
        </p>
        {error && <div className="error-banner" style={{ whiteSpace: "pre-line" }}>{error}</div>}
        {revealed && (
          <div className="secret-reveal">
            <strong>API key for {revealed.code} — copy it now, it will not be shown again:</strong>
            <div style={{ fontFamily: "monospace", margin: "8px 0" }}>{revealed.apiKey}</div>
            <div className="form-row">
              <button type="button" className="secondary" onClick={() => navigator.clipboard?.writeText(revealed.apiKey)}>Copy</button>
              <button type="button" className="secondary" onClick={() => setRevealed(null)}>I've stored it</button>
            </div>
          </div>
        )}
        <div className="form-row">
          <button type="button" onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "Add terminal"}</button>
          <button type="button" className="secondary" onClick={() => setShowDocs((v) => !v)}>
            {showDocs ? "Hide" : "Show"} integration guide for the POS vendor
          </button>
        </div>
        {showForm && (
          <form onSubmit={create} style={{ marginTop: 12 }}>
            <div className="form-row">
              <label className="stacked-label">
                Code
                <input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} style={{ width: 110 }} />
              </label>
              <label className="stacked-label">
                Name
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label className="stacked-label">
                FBR POSID
                <input required inputMode="numeric" value={form.fbrPosId} onChange={(e) => setForm({ ...form, fbrPosId: e.target.value.replace(/\D/g, "") })} style={{ width: 120 }} />
              </label>
            </div>
            <div className="form-row">
              <label className="stacked-label">
                Walk-in customer
                <select required value={form.walkInPartnerId} onChange={(e) => setForm({ ...form, walkInPartnerId: e.target.value })}>
                  <option value="">Select…</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}
                </select>
              </label>
              <label className="stacked-label">
                Cash account
                <select required value={form.cashAccountId} onChange={(e) => setForm({ ...form, cashAccountId: e.target.value })}>
                  <option value="">Select…</option>
                  {cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                </select>
              </label>
              <label className="stacked-label">
                Card sales account (optional)
                <select value={form.cardAccountId} onChange={(e) => setForm({ ...form, cardAccountId: e.target.value })}>
                  <option value="">Same as cash</option>
                  {cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                </select>
              </label>
            </div>
            <div className="form-row">
              <label className="stacked-label">
                Warehouse (stock items)
                <select value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}>
                  <option value="">Company default</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} {w.name}</option>)}
                </select>
              </label>
              <label className="stacked-label">
                Cost center (optional)
                <select value={form.costCenterId} onChange={(e) => setForm({ ...form, costCenterId: e.target.value })}>
                  <option value="">None</option>
                  {costCenters.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}
                </select>
              </label>
            </div>
            <button type="submit">Create terminal &amp; issue key</button>
          </form>
        )}
      </div>

      {showDocs && (
        <div className="card">
          <h3>Integration guide (for the POS software vendor)</h3>
          <p className="muted">
            Authenticate every request with the terminal's key in the <code>X-POS-Key</code> header. Items are referenced by
            their ERP item code, and every item must have an HS code. Send the request when the sale is completed, and print the
            returned FBR invoice number and QR code on the receipt. If <code>fbr.status</code> is <code>PENDING</code>, print
            the receipt anyway and fetch the FBR number later with GET.
          </p>
          <h4>Record a sale</h4>
          <div className="code-block">{SAMPLE_SALE}</div>
          <h4>Response</h4>
          <div className="code-block">{SAMPLE_RESPONSE}</div>
          <h4>Return (refund) against a sale</h4>
          <div className="code-block">{SAMPLE_RETURN}</div>
          <h4>Look up a sale / poll a pending FBR number</h4>
          <div className="code-block">{`GET ${window.location.origin}/api/pos/v1/sales/{clientSaleId}\nX-POS-Key: <terminal key>`}</div>
          <p className="muted">Errors: 400 invalid data (message says what), 401 missing, revoked or rotated key, 409 FBR reporting not enabled, 429 over 120 requests/min.</p>
        </div>
      )}

      <div className="card">
        <div className="form-row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Terminals &amp; daily reconciliation</h3>
          <label className="stacked-label inline">
            Day
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        <table>
          <thead>
            <tr>
              <th>Terminal</th>
              <th>POSID</th>
              <th>Cash / card account</th>
              <th>Key</th>
              <th style={{ textAlign: "right" }}>Sales</th>
              <th style={{ textAlign: "right" }}>Net sales</th>
              <th style={{ textAlign: "right" }}>FBR acknowledged</th>
              <th style={{ textAlign: "right" }}>POS fees</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {terminals.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">No terminals yet.</td>
              </tr>
            )}
            {terminals.map((t) => {
              const d = daily.find((r) => r.terminal.id === t.id);
              return (
                <tr key={t.id} style={{ opacity: t.isActive ? 1 : 0.55 }}>
                  <td>
                    <strong>{t.code}</strong> {t.name}
                    {!t.isActive && <span className="badge reversed" style={{ marginLeft: 6 }}>revoked</span>}
                    <div className="muted">Last used: {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : "never"}</div>
                  </td>
                  <td>{t.fbrPosId}</td>
                  <td>
                    {nameOf(cashAccounts, t.cashAccountId)}
                    <div className="muted">{t.cardAccountId ? nameOf(cashAccounts, t.cardAccountId) : "card → cash"}</div>
                  </td>
                  <td style={{ fontFamily: "monospace", fontSize: 12 }}>{t.apiKeyPrefix}…</td>
                  <td style={{ textAlign: "right" }}>{d?.transactions ?? 0}</td>
                  <td style={{ textAlign: "right" }}>{Number(d?.netSales ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td style={{ textAlign: "right" }}>
                    {Number(d?.fbrAcknowledgedAmount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    {!!d?.fbrOutstanding && <div><span className="badge draft">{d.fbrOutstanding} not yet acknowledged</span></div>}
                  </td>
                  <td style={{ textAlign: "right" }}>{Number(d?.posFees ?? 0).toFixed(2)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="secondary" onClick={() => rotate(t)}>New key</button>{" "}
                    <button className="secondary" onClick={() => toggleActive(t)}>{t.isActive ? "Revoke" : "Reactivate"}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
