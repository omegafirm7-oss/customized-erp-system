import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { apiClient } from "../api/client";
import { useDocumentPdfDownload } from "../hooks/useDocumentPdfDownload";
import { useCanDownload } from "../hooks/useCanDownload";
import fbrLogoUrl from "../assets/fbr-digital-invoicing-logo.jpg";

interface Terminal {
  id: string;
  code: string;
  name: string;
  fbrPosId: number;
}

interface SellableItem {
  id: string;
  code: string;
  name: string;
  itemType: string;
  vatCategory: string;
  hsCode: string | null;
  defaultSalesPrice: string | null;
}

interface CartLine {
  itemCode: string;
  name: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
}

interface SaleResult {
  clientSaleId: string;
  type: "SALE" | "RETURN";
  erpInvoiceNumber: string;
  dateTime: string;
  paymentMode: number;
  buyer: { name?: string; ntnCnic?: string; phone?: string } | null;
  lines: Array<{ itemCode: string | null; description: string; quantity: string; taxRate: string; netAmount: string; taxAmount: string; amount: string }>;
  fbr: {
    status: "VALID" | "PENDING" | "INVALID" | "FAILED" | "NOT_REPORTED";
    environment: string | null;
    invoiceNumber: string | null;
    qrPayload: string | null;
    errors: Array<{ code: string; message: string }> | null;
  };
  totals: { saleValue: string; salesTax: string; furtherTax: string; total: string; posFee: string; amountPayable: string };
}

interface Company {
  legalName: string;
  tradeName: string | null;
  ntn: string | null;
  strn: string | null;
  addressLine1: string | null;
  city: string | null;
}

const PAYMENT_LABELS: Record<number, string> = { 1: "Cash", 2: "Card", 3: "Gift voucher", 4: "Loyalty card", 5: "Mixed", 6: "Cheque" };
const TERMINAL_KEY = "pos-counter-terminal";

/** Pakistan-local calendar date (UTC+5, no DST). */
function pkToday() {
  return new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
}

function rs(value: string | number) {
  return Number(value).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function errorText(err: any, fallback: string) {
  const m = err?.response?.data?.message;
  return Array.isArray(m) ? m.join("; ") : m ?? fallback;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Self-contained 80mm thermal receipt HTML (inline styles, QR as data URL). */
export async function buildReceiptHtml(sale: SaleResult, company: Company | null, terminal: Terminal) {
  const qr = sale.fbr.qrPayload ? await QRCode.toDataURL(sale.fbr.qrPayload, { width: 240, margin: 0 }) : null;
  const lines = sale.lines
    .map(
      (l) => `<tr><td colspan="3">${escapeHtml(l.description)}</td></tr>
        <tr><td>${Number(l.quantity)} x</td><td class="r">${l.taxRate}% tax</td><td class="r">${rs(l.amount)}</td></tr>`,
    )
    .join("");
  const notLive = sale.fbr.environment && sale.fbr.environment !== "PRODUCTION";
  const html = `<!doctype html><html><head><title>${escapeHtml(sale.erpInvoiceNumber)}</title><style>
    @page { size: 80mm auto; margin: 3mm; }
    body { font-family: "Courier New", monospace; font-size: 11px; width: 72mm; margin: 0 auto; color: #000; }
    h1 { font-size: 14px; text-align: center; margin: 0 0 2px; }
    .c { text-align: center; } .r { text-align: right; } .b { font-weight: bold; }
    table { width: 100%; border-collapse: collapse; } td { padding: 1px 0; vertical-align: top; }
    hr { border: 0; border-top: 1px dashed #000; margin: 5px 0; }
    img.qr { width: 25.4mm; height: 25.4mm; display: block; margin: 4px auto; }
    img.logo { width: 18mm; height: 18mm; display: block; margin: 0 auto 2px; }
    .warn { border: 1px solid #000; padding: 3px; text-align: center; font-weight: bold; margin-top: 4px; }
  </style></head><body>
    <h1>${escapeHtml(company?.tradeName || company?.legalName || "")}</h1>
    <div class="c">${escapeHtml([company?.addressLine1, company?.city].filter(Boolean).join(", "))}</div>
    <div class="c">NTN: ${escapeHtml(company?.ntn ?? "-")}${company?.strn ? ` &nbsp; STRN: ${escapeHtml(company.strn)}` : ""}</div>
    <hr/>
    <div class="c b">${sale.type === "RETURN" ? "RETURN / REFUND" : "SALES TAX INVOICE"}</div>
    <table>
      <tr><td>Invoice</td><td class="r">${escapeHtml(sale.erpInvoiceNumber)}</td></tr>
      <tr><td>Date</td><td class="r">${new Date(sale.dateTime).toLocaleString("en-PK")}</td></tr>
      <tr><td>Counter</td><td class="r">${escapeHtml(terminal.code)} (POS ${terminal.fbrPosId})</td></tr>
      ${sale.buyer?.name ? `<tr><td>Patient</td><td class="r">${escapeHtml(sale.buyer.name)}</td></tr>` : ""}
      ${sale.buyer?.ntnCnic ? `<tr><td>CNIC/NTN</td><td class="r">${escapeHtml(sale.buyer.ntnCnic)}</td></tr>` : ""}
    </table>
    <hr/><table>${lines}</table><hr/>
    <table>
      <tr><td>Value excl. tax</td><td class="r">${rs(sale.totals.saleValue)}</td></tr>
      <tr><td>Sales tax</td><td class="r">${rs(sale.totals.salesTax)}</td></tr>
      ${Number(sale.totals.furtherTax) ? `<tr><td>Further tax</td><td class="r">${rs(sale.totals.furtherTax)}</td></tr>` : ""}
      ${Number(sale.totals.posFee) ? `<tr><td>FBR POS fee</td><td class="r">${rs(sale.totals.posFee)}</td></tr>` : ""}
      <tr class="b"><td>TOTAL (Rs.)</td><td class="r">${rs(sale.totals.amountPayable)}</td></tr>
      <tr><td>Paid by</td><td class="r">${PAYMENT_LABELS[sale.paymentMode] ?? "-"}</td></tr>
    </table>
    <hr/>
    <div class="c b">FBR Invoice No.</div>
    <div class="c">${sale.fbr.invoiceNumber ? escapeHtml(sale.fbr.invoiceNumber) : "PENDING — will be issued shortly"}</div>
    ${qr ? `<img class="qr" src="${qr}" alt="FBR QR"/>` : ""}
    <img class="logo" src="${new URL(fbrLogoUrl, window.location.origin).href}" alt="FBR"/>
    <div class="c">Verify this invoice with FBR by scanning the QR code.</div>
    ${notLive ? `<div class="warn">TEST MODE (${escapeHtml(sale.fbr.environment!)}) — NOT A VALID TAX INVOICE</div>` : ""}
    <div class="c" style="margin-top:6px">Thank you</div>
  </body></html>`;
  return html;
}

/**
 * Prints through a hidden iframe rather than a pop-up window: counter PCs
 * often run pop-up blockers, and an iframe needs no permission.
 */
async function printThermalReceipt(sale: SaleResult, company: Company | null, terminal: Terminal) {
  const html = await buildReceiptHtml(sale, company, terminal);
  document.getElementById("pos-receipt-frame")?.remove();
  const frame = document.createElement("iframe");
  frame.id = "pos-receipt-frame";
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  // Wait for the QR/logo images before printing, or they print blank.
  await Promise.all(
    Array.from(doc.images).map((img) => (img.complete ? Promise.resolve() : new Promise((resolve) => ((img.onload = resolve), (img.onerror = resolve))))),
  );
  frame.contentWindow!.focus();
  frame.contentWindow!.print();
}

async function loadImageDataUrl(url: string): Promise<string | null> {
  try {
    const blob = await (await fetch(url)).blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export function PosCounterPage() {
  const canDownload = useCanDownload();
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [terminalId, setTerminalId] = useState<string>(() => {
    try {
      return localStorage.getItem(TERMINAL_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [items, setItems] = useState<SellableItem[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [buyer, setBuyer] = useState({ name: "", phone: "", ntnCnic: "" });
  const [paymentMode, setPaymentMode] = useState(1);
  // One id per cart: a retried "Charge" after a network hiccup resends the
  // same id, so the server returns the existing sale instead of a duplicate.
  const [clientSaleId, setClientSaleId] = useState(() => `C-${Date.now()}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSale, setLastSale] = useState<SaleResult | null>(null);
  const [todaysSales, setTodaysSales] = useState<SaleResult[]>([]);
  const { download } = useDocumentPdfDownload("sales");

  const terminal = terminals.find((t) => t.id === terminalId) ?? null;

  useEffect(() => {
    apiClient
      .get<Terminal[]>("/pos/terminals/active")
      .then((res) => {
        setTerminals(res.data);
        if (!res.data.some((t) => t.id === terminalId) && res.data[0]) setTerminalId(res.data[0].id);
      })
      .catch((err) => setError(errorText(err, "Failed to load POS terminals")));
    apiClient.get<Company>("/companies/current").then((res) => setCompany(res.data)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSales = useCallback(async () => {
    if (!terminalId) return;
    const res = await apiClient.get<SaleResult[]>(`/pos/counter/${terminalId}/sales?date=${pkToday()}`);
    setTodaysSales(res.data);
  }, [terminalId]);

  useEffect(() => {
    if (!terminalId) return;
    try {
      localStorage.setItem(TERMINAL_KEY, terminalId);
    } catch {
      // remembering the counter is a convenience only
    }
    apiClient.get<SellableItem[]>(`/pos/counter/${terminalId}/items`).then((res) => setItems(res.data)).catch((err) => setError(errorText(err, "Failed to load items")));
    loadSales().catch(() => undefined);
  }, [terminalId, loadSales]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (q ? items.filter((i) => i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q)) : items).slice(0, 60);
  }, [items, search]);

  const cartTotal = cart.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0) - (Number(l.discountAmount) || 0), 0);

  function addItem(item: SellableItem) {
    setCart((prev) => {
      const existing = prev.find((l) => l.itemCode === item.code);
      if (existing) return prev.map((l) => (l === existing ? { ...l, quantity: String((Number(l.quantity) || 0) + 1) } : l));
      return [...prev, { itemCode: item.code, name: item.name, quantity: "1", unitPrice: item.defaultSalesPrice ? String(Number(item.defaultSalesPrice)) : "", discountAmount: "0" }];
    });
  }

  function updateLine(index: number, patch: Partial<CartLine>) {
    setCart((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function resetCart() {
    setCart([]);
    setBuyer({ name: "", phone: "", ntnCnic: "" });
    setPaymentMode(1);
    setClientSaleId(`C-${Date.now()}`);
  }

  async function charge() {
    if (!terminal) return;
    setError(null);
    if (cart.some((l) => !(Number(l.unitPrice) > 0) || !(Number(l.quantity) > 0))) {
      setError("Every line needs a quantity and a price");
      return;
    }
    setBusy(true);
    try {
      const res = await apiClient.post<SaleResult>(`/pos/counter/${terminal.id}/sales`, {
        clientSaleId,
        paymentMode,
        pricesIncludeTax: true,
        ...(buyer.name || buyer.phone || buyer.ntnCnic
          ? { buyer: { ...(buyer.name ? { name: buyer.name } : {}), ...(buyer.phone ? { phone: buyer.phone } : {}), ...(buyer.ntnCnic ? { ntnCnic: buyer.ntnCnic } : {}) } }
          : {}),
        lines: cart.map((l) => ({ itemCode: l.itemCode, quantity: l.quantity, unitPrice: l.unitPrice, discountAmount: l.discountAmount || "0" })),
      });
      setLastSale(res.data);
      resetCart();
      await loadSales();
    } catch (err) {
      setError(errorText(err, "Sale failed"));
    } finally {
      setBusy(false);
    }
  }

  async function reprint(sale: SaleResult) {
    if (!terminal) return;
    setError(null);
    try {
      // Refresh first: a PENDING sale may have its FBR number by now.
      const fresh = (await apiClient.get<SaleResult>(`/pos/counter/${terminal.id}/sales/${encodeURIComponent(sale.clientSaleId)}`)).data;
      await printThermalReceipt(fresh, company, terminal);
      await loadSales();
    } catch (err: any) {
      setError(err?.message ?? errorText(err, "Could not print receipt"));
    }
  }

  async function downloadA4(sale: SaleResult) {
    const qrDataUrl = sale.fbr.qrPayload ? await QRCode.toDataURL(sale.fbr.qrPayload, { width: 300, margin: 1 }) : null;
    download({
      docTypeLabel: sale.type === "RETURN" ? "Credit Note" : "Sales Tax Invoice",
      documentNumber: sale.erpInvoiceNumber,
      documentDate: sale.dateTime,
      partnerLabel: "Patient",
      partner: { name: sale.buyer?.name || "Walk-in", code: sale.buyer?.ntnCnic || "-" },
      lines: sale.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPrice: Number(l.amount) / Number(l.quantity),
        amounts: { net: l.netAmount, tax: l.taxAmount, rate: l.taxRate, gross: l.amount },
      })),
      fiscal: {
        authority: "FBR",
        invoiceNumber: sale.fbr.invoiceNumber,
        qrDataUrl,
        logoDataUrl: await loadImageDataUrl(fbrLogoUrl),
        testEnvironment: sale.fbr.environment && sale.fbr.environment !== "PRODUCTION" ? sale.fbr.environment : null,
      },
    });
  }

  async function processReturn(sale: SaleResult) {
    if (!terminal) return;
    const soldItems = sale.lines.map((l, i) => `${i + 1}. ${l.description} × ${Number(l.quantity)}`).join("\n");
    const choice = window.prompt(`Return which line? Enter the line number (refund is priced as sold):\n${soldItems}`, "1");
    if (!choice) return;
    const line = sale.lines[Number(choice) - 1];
    if (!line) return setError("No such line");
    const qty = window.prompt(`Quantity to return (max ${Number(line.quantity)})`, String(Number(line.quantity)));
    if (!qty) return;
    if (!line.itemCode) return setError("This line has no item code and cannot be returned here");
    setError(null);
    setBusy(true);
    try {
      const res = await apiClient.post<SaleResult>(`/pos/counter/${terminal.id}/sales/${encodeURIComponent(sale.clientSaleId)}/returns`, {
        clientSaleId: `R-${Date.now()}`,
        lines: [{ itemCode: line.itemCode, quantity: qty }],
      });
      setLastSale(res.data);
      await loadSales();
    } catch (err) {
      setError(errorText(err, "Return failed"));
    } finally {
      setBusy(false);
    }
  }

  if (terminals.length === 0) {
    return (
      <div className="card">
        <h2>POS Counter</h2>
        {error ? <div className="error-banner">{error}</div> : <p>No active POS terminal. An administrator must add one under FBR → POS Terminals.</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="card">
        <div className="form-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>POS Counter</h2>
          <label className="stacked-label inline">
            Counter
            <select value={terminalId} onChange={(e) => setTerminalId(e.target.value)}>
              {terminals.map((t) => (
                <option key={t.id} value={t.id}>{t.code} — {t.name}</option>
              ))}
            </select>
          </label>
        </div>
        {error && <div className="error-banner" style={{ whiteSpace: "pre-line" }}>{error}</div>}
        {lastSale && (
          <div className={lastSale.fbr.status === "VALID" ? "success-banner" : "secret-reveal"}>
            <strong>{lastSale.type === "RETURN" ? "Refund" : "Sale"} {lastSale.erpInvoiceNumber}</strong> — Rs. {rs(lastSale.totals.amountPayable)} ·{" "}
            {lastSale.fbr.status === "VALID"
              ? `FBR invoice ${lastSale.fbr.invoiceNumber}`
              : lastSale.fbr.status === "PENDING"
                ? "FBR number pending (FBR unreachable — retried automatically; reprint later)"
                : `FBR: ${lastSale.fbr.status}`}{" "}
            <button className="secondary" onClick={() => reprint(lastSale)}>Print receipt</button>{" "}
            {canDownload && <button className="secondary" onClick={() => downloadA4(lastSale)}>A4 PDF</button>}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.3fr)", gap: 16 }}>
        <div className="card">
          <input placeholder="Search treatments / products…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: "100%", marginBottom: 10 }} autoFocus />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
            {filteredItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="secondary"
                onClick={() => addItem(item)}
                disabled={!item.hsCode}
                title={item.hsCode ? item.code : "No HS/PCT code — set it under Items before selling"}
                style={{ textAlign: "left", padding: 10, minHeight: 64 }}
              >
                <div style={{ fontWeight: 600 }}>{item.name}</div>
                <div className="muted">
                  {item.defaultSalesPrice ? `Rs. ${rs(item.defaultSalesPrice)}` : "price at counter"}
                  {item.vatCategory === "PK_SERVICES" ? " · service" : ""}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Current bill</h3>
          {cart.length === 0 && <p className="muted">Tap a treatment or product to add it.</p>}
          {cart.length > 0 && (
            <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Price incl. tax</th>
                  <th>Disc.</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {cart.map((line, i) => (
                  <tr key={line.itemCode}>
                    <td>{line.name}</td>
                    <td><input type="number" min="1" step="any" value={line.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} style={{ width: 48 }} /></td>
                    <td><input type="number" min="0" step="0.01" value={line.unitPrice} onChange={(e) => updateLine(i, { unitPrice: e.target.value })} style={{ width: 84 }} /></td>
                    <td><input type="number" min="0" step="0.01" value={line.discountAmount} onChange={(e) => updateLine(i, { discountAmount: e.target.value })} style={{ width: 60 }} /></td>
                    <td><button className="secondary" onClick={() => setCart((prev) => prev.filter((_, j) => j !== i))}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
          <div className="form-row" style={{ marginTop: 10 }}>
            <input placeholder="Patient name (optional)" value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} />
            <input placeholder="Phone" value={buyer.phone} onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })} style={{ width: 130 }} />
            <input placeholder="CNIC (13 digits)" value={buyer.ntnCnic} onChange={(e) => setBuyer({ ...buyer, ntnCnic: e.target.value.replace(/\D/g, "") })} style={{ width: 150 }} />
          </div>
          <div className="form-row">
            {[1, 2].map((mode) => (
              <label key={mode} className="stacked-label inline">
                <input type="radio" checked={paymentMode === mode} onChange={() => setPaymentMode(mode)} /> {PAYMENT_LABELS[mode]}
              </label>
            ))}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, margin: "10px 0" }}>Rs. {rs(cartTotal)}</div>
          <p className="muted" style={{ marginTop: -6 }}>Prices include sales tax. The FBR POS fee is added on the receipt.</p>
          <div className="form-row">
            <button type="button" disabled={busy || cart.length === 0} onClick={charge} style={{ fontSize: 16, padding: "10px 24px" }}>
              {busy ? "Reporting to FBR…" : "Charge & report to FBR"}
            </button>
            <button type="button" className="secondary" disabled={busy || cart.length === 0} onClick={resetCart}>Clear</button>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Today on this counter</h3>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Invoice</th>
              <th>Patient</th>
              <th style={{ textAlign: "right" }}>Amount</th>
              <th>FBR</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {todaysSales.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">No sales yet today.</td>
              </tr>
            )}
            {todaysSales.map((sale) => (
              <tr key={sale.clientSaleId}>
                <td>{new Date(sale.dateTime).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" })}</td>
                <td>
                  {sale.erpInvoiceNumber}
                  {sale.type === "RETURN" && <span className="badge reversed" style={{ marginLeft: 6 }}>refund</span>}
                </td>
                <td>{sale.buyer?.name ?? "—"}</td>
                <td style={{ textAlign: "right" }}>{sale.type === "RETURN" ? "−" : ""}{rs(sale.totals.amountPayable)}</td>
                <td>
                  <span className={`badge ${sale.fbr.status === "VALID" ? "posted" : sale.fbr.status === "PENDING" ? "draft" : "reversed"}`} title={sale.fbr.errors?.map((e) => e.message).join("; ")}>
                    {sale.fbr.status === "VALID" ? sale.fbr.invoiceNumber : sale.fbr.status}
                  </span>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="secondary" onClick={() => reprint(sale)}>Receipt</button>{" "}
                  {canDownload && <button className="secondary" onClick={() => downloadA4(sale)}>A4</button>}{" "}
                  {sale.type === "SALE" && <button className="secondary" disabled={busy} onClick={() => processReturn(sale)}>Return</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
