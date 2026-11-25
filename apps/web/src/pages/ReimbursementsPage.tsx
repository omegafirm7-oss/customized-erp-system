import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiClient } from "../api/client";
import { AttachButton } from "../components/AttachButton";
import { useCanDownload } from "../hooks/useCanDownload";
import { useHasPermission } from "../hooks/useHasPermission";
import { downloadCsv } from "../utils/csv";
import { replaceLineEvidence } from "../utils/lineEvidence";

interface Payee {
  id: string;
  code: string;
  name: string;
  staffRole: string | null;
  spent: string;
  repaid: string;
  owed: string;
  draftCount: number;
}

interface StatementRow {
  id: string;
  date: string;
  receiptNumber: string;
  supplierName: string | null;
  supplierVat: string | null;
  status: string;
  net: string;
  vat: string;
  gross: string;
  repaid: string;
  owed: string;
  lines: Array<{ id: string; description: string; project: string | null; account: string; hasEvidence: boolean }>;
}

interface Statement {
  payee: { id: string; code: string; name: string; staffRole: string | null };
  spent: string;
  repaid: string;
  owed: string;
  rows: StatementRow[];
}

interface Account {
  id: string;
  code: string;
  name: string;
  isPostable: boolean;
  controlAccountType?: string | null;
  accountClass?: { code: string };
}

interface ProjectRef {
  id: string;
  code: string;
  name: string;
  status: string;
}

const money = (v: string | number) => Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Costs that a director, project manager or supervisor pays out of their own pocket. Each expense lands on the project
 * straight away (VAT included when there is a VAT invoice); what the company owes the person stays open until it
 * repays them, and repaying never changes the project's cost.
 */
export function ReimbursementsPage() {
  const canDownload = useCanDownload();
  const canCreate = useHasPermission("ap.invoice.create");
  const canPost = useHasPermission("ap.invoice.post");
  const canPay = useHasPermission("payments.payment.create");
  const [payees, setPayees] = useState<Payee[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [person, setPerson] = useState({ name: "", role: "Project Manager" });
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const emptyExpense = {
    date: today(),
    supplierName: "",
    supplierVat: "",
    receiptNumber: "",
    projectId: "",
    accountId: "",
    description: "",
    amount: "",
    hasVatInvoice: true,
  };
  const [expense, setExpense] = useState(emptyExpense);
  const [repay, setRepay] = useState({ date: today(), bankCashAccountId: "", amount: "", reference: "" });

  const loadPayees = useCallback(async () => {
    const res = await apiClient.get<Payee[]>("/reimbursements/payees");
    setPayees(res.data);
  }, []);

  const loadStatement = useCallback(async (id: string) => {
    const res = await apiClient.get<Statement>(`/reimbursements/payees/${id}/statement`);
    setStatement(res.data);
  }, []);

  useEffect(() => {
    loadPayees().catch(() => setError("Could not load the reimbursement list"));
    apiClient.get<Account[]>("/coa/accounts").then((res) => setAccounts(res.data.filter((a) => a.isPostable)));
    apiClient.get<ProjectRef[]>("/projects").then((res) => setProjects(res.data.filter((p) => p.status === "ACTIVE")));
  }, [loadPayees]);

  useEffect(() => {
    if (selected) loadStatement(selected).catch(() => setError("Could not load this person's statement"));
    else setStatement(null);
  }, [selected, loadStatement]);

  const expenseAccounts = accounts.filter((a) => a.accountClass?.code === "EXPENSE");
  const bankAccounts = accounts.filter((a) => a.controlAccountType === "BANK" || a.controlAccountType === "CASH");

  async function refresh() {
    await loadPayees();
    if (selected) await loadStatement(selected);
  }

  async function addPerson(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await apiClient.post<{ id: string }>("/reimbursements/payees", { name: person.name, role: person.role });
      setPerson({ name: "", role: person.role });
      await loadPayees();
      setSelected(res.data.id);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Could not add this person");
    } finally {
      setBusy(false);
    }
  }

  async function recordExpense(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await apiClient.post<{ id: string; lines: Array<{ id: string }> }>(`/reimbursements/payees/${selected}/expenses`, {
        date: new Date(expense.date).toISOString(),
        supplierName: expense.supplierName,
        supplierVat: expense.hasVatInvoice ? expense.supplierVat : undefined,
        receiptNumber: expense.receiptNumber,
        projectId: expense.projectId || undefined,
        accountId: expense.accountId,
        description: expense.description,
        amount: expense.amount,
        hasVatInvoice: expense.hasVatInvoice,
        post: canPost,
      });
      let evidenceNote = "";
      if (receiptFile && res.data.lines[0]) {
        try {
          await replaceLineEvidence(res.data.lines[0].id, receiptFile);
        } catch {
          evidenceNote = " The expense was saved, but the receipt photo failed to upload — attach it again from Purchase Invoices.";
        }
      }
      setExpense({ ...emptyExpense, date: expense.date, projectId: expense.projectId, accountId: expense.accountId });
      setReceiptFile(null);
      setNotice((canPost ? "Expense recorded on the project." : "Expense saved as a draft for approval.") + evidenceNote);
      await refresh();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Could not record this expense");
    } finally {
      setBusy(false);
    }
  }

  async function reimburse(e: FormEvent) {
    e.preventDefault();
    if (!selected || !statement) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await apiClient.post(`/reimbursements/payees/${selected}/reimburse`, {
        paymentDate: new Date(repay.date).toISOString(),
        bankCashAccountId: repay.bankCashAccountId,
        amount: repay.amount || undefined,
        reference: repay.reference || undefined,
      });
      setRepay({ ...repay, amount: "", reference: "" });
      setNotice(`Reimbursed ${statement.payee.name}.`);
      await refresh();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Could not record this reimbursement");
    } finally {
      setBusy(false);
    }
  }

  function downloadStatement() {
    if (!statement) return;
    downloadCsv(
      `reimbursements-${statement.payee.name.replace(/\s+/g, "-")}.csv`,
      ["Date", "Receipt no.", "Bought from", "Supplier VAT no.", "Project", "Account", "Description", "Net", "VAT", "Total paid", "Repaid", "Still owed", "Status"],
      [
        ...statement.rows.map((r) => [
          r.date.slice(0, 10),
          r.receiptNumber,
          r.supplierName ?? "",
          r.supplierVat ?? "",
          r.lines.map((l) => l.project ?? "").join("; "),
          r.lines.map((l) => l.account).join("; "),
          r.lines.map((l) => l.description).join("; "),
          r.net,
          r.vat,
          r.gross,
          r.repaid,
          r.owed,
          r.status,
        ]),
        ["", "", "", "", "", "", "Total", "", "", statement.spent, statement.repaid, statement.owed, ""],
      ],
    );
  }

  return (
    <div>
      <h2>Reimbursements</h2>
      <p style={{ color: "#667085", fontSize: 13 }}>
        Costs a director, project manager or supervisor paid out of their own pocket. Each expense is charged to the project
        immediately; the company owes the person until it repays them, and repaying never changes the project's cost.
      </p>
      {error && <div className="error-banner">{error}</div>}
      {notice && <p style={{ color: "#027a48" }}>{notice}</p>}

      <div className="card">
        <h3>People owed money</h3>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th style={{ textAlign: "right" }}>Spent for the company</th>
              <th style={{ textAlign: "right" }}>Repaid</th>
              <th style={{ textAlign: "right" }}>Still owed</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {payees.map((p) => (
              <tr key={p.id} style={selected === p.id ? { background: "#eef4ff" } : undefined}>
                <td>{p.name}</td>
                <td>{p.staffRole ?? "—"}</td>
                <td style={{ textAlign: "right" }}>{money(p.spent)}</td>
                <td style={{ textAlign: "right" }}>{money(p.repaid)}</td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>{money(p.owed)}</td>
                <td>
                  <button className="secondary" onClick={() => setSelected(selected === p.id ? null : p.id)}>
                    {selected === p.id ? "Close" : "Open"}
                  </button>
                  {p.draftCount > 0 && <span style={{ color: "#b54708", fontSize: 12, marginLeft: 8 }}>{p.draftCount} draft(s) awaiting posting</span>}
                </td>
              </tr>
            ))}
            {payees.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: "#98a2b3" }}>
                  No one yet. Add the director, project manager or supervisor below.
                </td>
              </tr>
            )}
          </tbody>
          {payees.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={4} style={{ textAlign: "right", fontWeight: 700 }}>
                  Total owed to staff
                </td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>{money(payees.reduce((s, p) => s + Number(p.owed), 0))}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
        {canCreate && (
          <form onSubmit={addPerson} className="form-row" style={{ marginTop: 12 }}>
            <input placeholder="Name" value={person.name} onChange={(e) => setPerson({ ...person, name: e.target.value })} required />
            <select value={person.role} onChange={(e) => setPerson({ ...person, role: e.target.value })}>
              <option>Director</option>
              <option>Project Manager</option>
              <option>Supervisor</option>
              <option>Other</option>
            </select>
            <button type="submit" disabled={busy || !person.name.trim()}>
              Add person
            </button>
          </form>
        )}
      </div>

      {selected && statement && (
        <>
          {canCreate && (
            <div className="card">
              <h3>Record an expense paid by {statement.payee.name}</h3>
              <form onSubmit={recordExpense}>
                <div className="form-row">
                  <div>
                    <label>Date </label>
                    <input type="date" value={expense.date} onChange={(e) => setExpense({ ...expense, date: e.target.value })} required />
                  </div>
                  <input placeholder="Bought from (supplier name)" value={expense.supplierName} onChange={(e) => setExpense({ ...expense, supplierName: e.target.value })} required style={{ flex: 1 }} />
                  <input placeholder="Receipt / invoice no." value={expense.receiptNumber} onChange={(e) => setExpense({ ...expense, receiptNumber: e.target.value })} required />
                </div>
                <div className="form-row">
                  <select value={expense.projectId} onChange={(e) => setExpense({ ...expense, projectId: e.target.value })} required>
                    <option value="">Charge to project…</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code} — {p.name}
                      </option>
                    ))}
                  </select>
                  <select value={expense.accountId} onChange={(e) => setExpense({ ...expense, accountId: e.target.value })} required>
                    <option value="">Expense account…</option>
                    {expenseAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </option>
                    ))}
                  </select>
                  <input placeholder="What was it for?" value={expense.description} onChange={(e) => setExpense({ ...expense, description: e.target.value })} required style={{ flex: 1 }} />
                </div>
                <div className="form-row">
                  <input type="number" step="0.01" min="0.01" placeholder="Total paid (VAT included)" value={expense.amount} onChange={(e) => setExpense({ ...expense, amount: e.target.value })} required />
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="checkbox" checked={expense.hasVatInvoice} onChange={(e) => setExpense({ ...expense, hasVatInvoice: e.target.checked })} />
                    I have the supplier's VAT invoice
                  </label>
                  {expense.hasVatInvoice && (
                    <input placeholder="Supplier VAT number" value={expense.supplierVat} onChange={(e) => setExpense({ ...expense, supplierVat: e.target.value })} required />
                  )}
                  <AttachButton uploading={false} label={receiptFile ? receiptFile.name.slice(0, 18) : "Attach receipt"} onFile={setReceiptFile} />
                </div>
                <p style={{ color: "#667085", fontSize: 12, margin: "4px 0 8px" }}>
                  {expense.hasVatInvoice
                    ? "15% VAT is separated from the total and claimed as input VAT; the rest is the project's cost."
                    : "No VAT invoice, so no VAT is claimed: the whole amount is the project's cost."}{" "}
                  {canPost ? "It is posted immediately." : "It is saved as a draft until someone with posting rights approves it."}
                </p>
                <button type="submit" disabled={busy}>
                  {canPost ? "Record expense" : "Save draft"}
                </button>
              </form>
            </div>
          )}

          <div className="card">
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <h3 style={{ margin: 0 }}>
                {statement.payee.name}
                {statement.payee.staffRole ? ` (${statement.payee.staffRole})` : ""} — statement
              </h3>
              <span>Spent {money(statement.spent)}</span>
              <span>Repaid {money(statement.repaid)}</span>
              <strong>Still owed {money(statement.owed)}</strong>
              {canDownload && (
                <button className="secondary" style={{ marginLeft: "auto" }} onClick={downloadStatement}>
                  Download (CSV)
                </button>
              )}
            </div>
            <div style={{ overflowX: "auto", marginTop: 8 }}>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Receipt no.</th>
                    <th>Bought from</th>
                    <th>Project</th>
                    <th>Account / purpose</th>
                    <th style={{ textAlign: "right" }}>Net</th>
                    <th style={{ textAlign: "right" }}>VAT</th>
                    <th style={{ textAlign: "right" }}>Total paid</th>
                    <th style={{ textAlign: "right" }}>Still owed</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.date.slice(0, 10)}</td>
                      <td>{r.receiptNumber}</td>
                      <td>
                        {r.supplierName ?? "—"}
                        {r.supplierVat ? <div style={{ fontSize: 11, color: "#667085" }}>VAT {r.supplierVat}</div> : null}
                      </td>
                      <td>{r.lines.map((l) => l.project ?? "—").join(", ")}</td>
                      <td>{r.lines.map((l) => `${l.account} — ${l.description}`).join(", ")}</td>
                      <td style={{ textAlign: "right" }}>{money(r.net)}</td>
                      <td style={{ textAlign: "right" }}>{money(r.vat)}</td>
                      <td style={{ textAlign: "right" }}>{money(r.gross)}</td>
                      <td style={{ textAlign: "right", fontWeight: 600 }}>{money(r.owed)}</td>
                      <td>{r.status === "DRAFT" ? "Draft" : r.status === "PAID" ? "Repaid" : r.status === "PARTIALLY_PAID" ? "Part repaid" : "Owed"}</td>
                    </tr>
                  ))}
                  {statement.rows.length === 0 && (
                    <tr>
                      <td colSpan={10} style={{ color: "#98a2b3" }}>
                        No expenses recorded for {statement.payee.name} yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {canPay && Number(statement.owed) > 0 && (
            <div className="card">
              <h3>Reimburse {statement.payee.name}</h3>
              <form onSubmit={reimburse} className="form-row">
                <div>
                  <label>Date </label>
                  <input type="date" value={repay.date} onChange={(e) => setRepay({ ...repay, date: e.target.value })} required />
                </div>
                <select value={repay.bankCashAccountId} onChange={(e) => setRepay({ ...repay, bankCashAccountId: e.target.value })} required>
                  <option value="">Pay from (bank / cash)…</option>
                  {bankAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
                <input type="number" step="0.01" min="0.01" max={statement.owed} placeholder={`Amount (all owed: ${money(statement.owed)})`} value={repay.amount} onChange={(e) => setRepay({ ...repay, amount: e.target.value })} />
                <input placeholder="Reference (optional)" value={repay.reference} onChange={(e) => setRepay({ ...repay, reference: e.target.value })} />
                <button type="submit" disabled={busy || !repay.bankCashAccountId}>
                  Reimburse
                </button>
              </form>
              <p style={{ color: "#667085", fontSize: 12 }}>
                Leave the amount empty to repay everything owed. A part payment clears the oldest expenses first. Repaying moves
                cash only — the project cost does not change.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
