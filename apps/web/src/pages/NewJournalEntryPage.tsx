import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../api/client";

interface Account {
  id: string;
  code: string;
  name: string;
  isPostable: boolean;
}

interface LineForm {
  accountId: string;
  debit: string;
  credit: string;
  description: string;
}

function emptyLine(): LineForm {
  return { accountId: "", debit: "0", credit: "0", description: "" };
}

export function NewJournalEntryPage() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [postingDate, setPostingDate] = useState(new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<LineForm[]>([emptyLine(), emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiClient.get<Account[]>("/coa/accounts").then((res) => setAccounts(res.data.filter((a) => a.isPostable)));
  }, []);

  const totalDebit = lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
  const balanced = totalDebit === totalCredit && totalDebit > 0;

  function updateLine(index: number, patch: Partial<LineForm>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.post("/gl/journal-entries", {
        postingDate,
        documentDate: postingDate,
        memo,
        lines: lines.map((l) => ({
          accountId: l.accountId,
          debit: l.debit || "0",
          credit: l.credit || "0",
          description: l.description || undefined,
        })),
      });
      navigate("/journal-entries");
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create journal entry");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <h2>New Journal Entry</h2>
      {error && <div className="error-banner">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <div>
            <label>Posting date</label>
            <br />
            <input type="date" value={postingDate} onChange={(e) => setPostingDate(e.target.value)} required />
          </div>
          <div style={{ flex: 1 }}>
            <label>Memo</label>
            <br />
            <input style={{ width: "100%" }} value={memo} onChange={(e) => setMemo(e.target.value)} />
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Debit</th>
              <th>Credit</th>
              <th>Description</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={index}>
                <td>
                  <select value={line.accountId} onChange={(e) => updateLine(index, { accountId: e.target.value })} required>
                    <option value="" disabled>
                      Select account…
                    </option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.debit}
                    onChange={(e) => updateLine(index, { debit: e.target.value, credit: "0" })}
                    style={{ width: 100 }}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.credit}
                    onChange={(e) => updateLine(index, { credit: e.target.value, debit: "0" })}
                    style={{ width: 100 }}
                  />
                </td>
                <td>
                  <input value={line.description} onChange={(e) => updateLine(index, { description: e.target.value })} />
                </td>
                <td>
                  {lines.length > 2 && (
                    <button type="button" className="secondary" onClick={() => removeLine(index)}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="form-row" style={{ justifyContent: "space-between", marginTop: 10 }}>
          <button type="button" className="secondary" onClick={addLine}>
            Add line
          </button>
          <span className={balanced ? "balance-ok" : "balance-bad"}>
            Debit {totalDebit.toFixed(2)} / Credit {totalCredit.toFixed(2)} {balanced ? "✓ balanced" : "— not balanced"}
          </span>
        </div>

        <button type="submit" disabled={submitting || !balanced} style={{ marginTop: 16 }}>
          {submitting ? "Saving…" : "Save as draft"}
        </button>
      </form>
    </div>
  );
}
