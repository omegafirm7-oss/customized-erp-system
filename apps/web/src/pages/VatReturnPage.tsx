import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../api/client";
import { useHasPermission } from "../hooks/useHasPermission";

interface Account {
  id: string;
  code: string;
  name: string;
  isPostable: boolean;
  isActive: boolean;
  controlAccountType: string | null;
  accountClass?: { code: string } | null;
}

interface Breakdown {
  vatCategory: string;
  netAmount: string;
  vatAmount: string;
}

interface VatReturnReport {
  fromDate: string;
  toDate: string;
  salesByCategory: Breakdown[];
  purchasesByCategory: Breakdown[];
  outputVat: string;
  inputVat: string;
  netVatPayable: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  STANDARD_15: "Standard-rated (15%)",
  ZERO_RATED: "Zero-rated (0%)",
  EXEMPT: "Exempt",
};

function firstOfMonth(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

export function VatReturnPage() {
  const [fromDate, setFromDate] = useState(firstOfMonth());
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<VatReturnReport | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const canCreateJournal = useHasPermission("gl.journal.create");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [pay, setPay] = useState({
    date: new Date().toISOString().slice(0, 10),
    bankAccountId: "",
    amount: "",
    differenceAccountId: "",
    reference: "",
  });

  useEffect(() => {
    setLoading(true);
    apiClient
      .get<VatReturnReport>("/reports/vat-return", { params: { fromDate, toDate } })
      .then((res) => setReport(res.data))
      .finally(() => setLoading(false));
  }, [fromDate, toDate]);

  useEffect(() => {
    if (!canCreateJournal) return;
    apiClient.get<Account[]>("/coa/accounts").then((res) => setAccounts(res.data.filter((a) => a.isPostable && a.isActive !== false)));
  }, [canCreateJournal]);

  const vatPayable = accounts.find((a) => a.controlAccountType === "VAT_OUTPUT");
  const vatReceivable = accounts.find((a) => a.controlAccountType === "VAT_INPUT");
  const bankAccounts = accounts.filter((a) => a.controlAccountType === "BANK" || a.controlAccountType === "CASH");

  function openPay() {
    if (!report) return;
    setPay((p) => ({ ...p, amount: Math.abs(Number(report.netVatPayable)).toFixed(2) }));
    setPayError(null);
    setPayOpen(true);
  }

  // Draft JE: Dr VAT Payable (output), Cr VAT Receivable (input), bank for the cash
  // actually moved. Any gap between the return's net and that cash (a fine, rounding)
  // goes to a chosen account, so the entry always balances and both VAT accounts
  // clear fully for the period.
  async function createPaymentEntry(e: FormEvent) {
    e.preventDefault();
    if (!report || !vatPayable || !vatReceivable) return;
    setPayError(null);
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const output = Number(report.outputVat);
    const input = Number(report.inputVat);
    const net = r2(output - input);
    const paid = r2(Number(pay.amount));
    if (!(paid > 0)) {
      setPayError("Enter the amount paid (or received).");
      return;
    }
    // Net payable: cash goes out (credit bank). Net refundable: cash comes in (debit bank).
    const bankSigned = net >= 0 ? paid : -paid;
    const difference = r2(bankSigned - net);
    if (Math.abs(difference) > 0.004 && !pay.differenceAccountId) {
      setPayError(
        `The amount differs from the return's net (${Math.abs(net).toFixed(2)}) by ${Math.abs(difference).toFixed(2)} — choose the account for that difference (e.g. a penalty expense).`,
      );
      return;
    }
    const lines: Array<{ accountId: string; debit: string; credit: string; description?: string }> = [];
    if (output > 0) lines.push({ accountId: vatPayable.id, debit: output.toFixed(2), credit: "0", description: "Clear output VAT" });
    if (input > 0) lines.push({ accountId: vatReceivable.id, debit: "0", credit: input.toFixed(2), description: "Clear input VAT" });
    lines.push(
      net >= 0
        ? { accountId: pay.bankAccountId, debit: "0", credit: paid.toFixed(2), description: "VAT paid" }
        : { accountId: pay.bankAccountId, debit: paid.toFixed(2), credit: "0", description: "VAT refund received" },
    );
    if (Math.abs(difference) > 0.004) {
      // Cash out more than the net owed => the extra is a cost (debit); less => a credit.
      lines.push(
        difference > 0
          ? { accountId: pay.differenceAccountId, debit: difference.toFixed(2), credit: "0", description: "VAT payment difference" }
          : { accountId: pay.differenceAccountId, debit: "0", credit: Math.abs(difference).toFixed(2), description: "VAT payment difference" },
      );
    }
    setPayBusy(true);
    try {
      await apiClient.post("/gl/journal-entries", {
        postingDate: pay.date,
        documentDate: pay.date,
        memo: `VAT payment — return period ${report.fromDate.slice(0, 10)} to ${report.toDate.slice(0, 10)}${pay.reference ? ` — ref ${pay.reference}` : ""}`,
        lines,
      });
      navigate("/journal-entries");
    } catch (err: any) {
      setPayError(err?.response?.data?.message ?? "Failed to create the journal entry");
    } finally {
      setPayBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="form-row" style={{ justifyContent: "space-between" }}>
        <h2>VAT Return Summary</h2>
        <div>
          <label>From </label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <label> To </label>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
      </div>
      {loading || !report ? (
        <p>Loading…</p>
      ) : (
        <>
          <h3>Sales (Output VAT)</h3>
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Net Sales</th>
                <th>VAT</th>
              </tr>
            </thead>
            <tbody>
              {report.salesByCategory.map((row) => (
                <tr key={row.vatCategory}>
                  <td>{CATEGORY_LABELS[row.vatCategory] ?? row.vatCategory}</td>
                  <td>{row.netAmount}</td>
                  <td>{row.vatAmount}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Purchases (Input VAT)</h3>
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Net Purchases</th>
                <th>VAT</th>
              </tr>
            </thead>
            <tbody>
              {report.purchasesByCategory.map((row) => (
                <tr key={row.vatCategory}>
                  <td>{CATEGORY_LABELS[row.vatCategory] ?? row.vatCategory}</td>
                  <td>{row.netAmount}</td>
                  <td>{row.vatAmount}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="card" style={{ marginTop: 16, background: "#f8f9fb" }}>
            <p>
              Output VAT: <strong>{report.outputVat}</strong>
            </p>
            <p>
              Input VAT (deductible): <strong>{report.inputVat}</strong>
            </p>
            <p>
              Net VAT {Number(report.netVatPayable) >= 0 ? "payable" : "refundable"}:{" "}
              <strong>{report.netVatPayable}</strong>
            </p>
            {canCreateJournal && (
              <div style={{ marginTop: 12 }}>
                {!payOpen ? (
                  <button type="button" onClick={openPay} disabled={!vatPayable || !vatReceivable}>
                    Record VAT {Number(report.netVatPayable) >= 0 ? "payment" : "refund"}
                  </button>
                ) : (
                  <form onSubmit={createPaymentEntry}>
                    <p style={{ color: "#667085", fontSize: 13 }}>
                      Creates a draft journal entry that clears VAT Payable ({report.outputVat}) and VAT Receivable ({report.inputVat}) for
                      this period against your bank. It is not an expense. Review it on the Journal Entries page, then post it.
                    </p>
                    <div className="form-row">
                      <div>
                        <label>Date </label>
                        <input type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} required />
                      </div>
                      <select value={pay.bankAccountId} onChange={(e) => setPay({ ...pay, bankAccountId: e.target.value })} required>
                        <option value="" disabled>
                          {Number(report.netVatPayable) >= 0 ? "Paid from…" : "Received into…"}
                        </option>
                        {bankAccounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} — {a.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        placeholder="Amount"
                        value={pay.amount}
                        onChange={(e) => setPay({ ...pay, amount: e.target.value })}
                        required
                        style={{ width: 130 }}
                      />
                      <input
                        placeholder="ZATCA payment reference (optional)"
                        value={pay.reference}
                        onChange={(e) => setPay({ ...pay, reference: e.target.value })}
                        style={{ flex: 1, minWidth: 220 }}
                      />
                    </div>
                    <div className="form-row">
                      <select value={pay.differenceAccountId} onChange={(e) => setPay({ ...pay, differenceAccountId: e.target.value })}>
                        <option value="">Account for any difference (penalty, rounding) — only needed if the amount differs</option>
                        {accounts
                          .filter((a) => a.accountClass?.code === "EXPENSE")
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.code} — {a.name}
                            </option>
                          ))}
                      </select>
                      <button type="submit" disabled={payBusy}>
                        {payBusy ? "Creating…" : "Create draft entry"}
                      </button>
                      <button type="button" className="secondary" onClick={() => setPayOpen(false)}>
                        Cancel
                      </button>
                    </div>
                    {payError && <div className="error-banner">{payError}</div>}
                  </form>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
