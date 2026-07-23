import { FormEvent, useEffect, useState } from "react";
import { apiClient } from "../api/client";

interface Account {
  id: string;
  code: string;
  name: string;
  parentAccountId: string | null;
  isPostable: boolean;
  normalBalance: "DEBIT" | "CREDIT";
  accountClass: { code: string; name: string };
}

// The sub-classes a manually-added expense/revenue account would normally
// use — asset/liability/equity sub-classes exist too but adding those
// safely needs the full balance-sheet placement (isCurrent, parent header),
// which this quick form deliberately doesn't attempt.
const ACCOUNT_SUB_CLASS_OPTIONS = [
  { code: "COST_OF_SALES", label: "Cost of Sales (direct project/job costs)" },
  { code: "OPERATING_EXPENSE", label: "Operating Expenses (company overhead)" },
  { code: "OTHER_INCOME", label: "Other Income" },
  { code: "OPERATING_REVENUE", label: "Operating Revenue" },
];

interface AccountNode extends Account {
  children: AccountNode[];
}

function buildTree(accounts: Account[]): AccountNode[] {
  const nodes = new Map<string, AccountNode>(accounts.map((a) => [a.id, { ...a, children: [] }]));
  const roots: AccountNode[] = [];
  for (const node of nodes.values()) {
    if (node.parentAccountId && nodes.has(node.parentAccountId)) {
      nodes.get(node.parentAccountId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function AccountRow({ node, depth }: { node: AccountNode; depth: number }) {
  return (
    <>
      <tr>
        <td style={{ paddingLeft: 10 + depth * 20 }}>{node.code}</td>
        <td>{node.isPostable ? node.name : <strong>{node.name}</strong>}</td>
        <td>{node.accountClass.name}</td>
        <td>{node.normalBalance}</td>
        <td>{node.isPostable ? "Postable" : "Header"}</td>
      </tr>
      {node.children.map((child) => (
        <AccountRow key={child.id} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

export function CoaPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    code: "",
    name: "",
    accountSubClassCode: "COST_OF_SALES",
    normalBalance: "DEBIT" as "DEBIT" | "CREDIT",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    setLoading(true);
    return apiClient
      .get<Account[]>("/coa/accounts")
      .then((res) => setAccounts(res.data))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.post("/coa/accounts", {
        code: form.code,
        name: form.name,
        accountSubClassCode: form.accountSubClassCode,
        normalBalance: form.normalBalance,
        isPostable: true,
      });
      setForm({ code: "", name: "", accountSubClassCode: "COST_OF_SALES", normalBalance: "DEBIT" });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create account");
    } finally {
      setSubmitting(false);
    }
  }

  const tree = buildTree(accounts);

  return (
    <div className="card">
      <h2>Chart of Accounts</h2>
      <div className="card" style={{ margin: "1rem 0" }}>
        <h3>Add account</h3>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={handleCreate}>
          <div className="form-row">
            <input
              placeholder="Code (e.g. 5101)"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              required
            />
            <input
              placeholder="Name (e.g. Direct Materials)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <select
              value={form.accountSubClassCode}
              onChange={(e) => setForm({ ...form, accountSubClassCode: e.target.value })}
            >
              {ACCOUNT_SUB_CLASS_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              value={form.normalBalance}
              onChange={(e) => setForm({ ...form, normalBalance: e.target.value as "DEBIT" | "CREDIT" })}
            >
              <option value="DEBIT">Debit-normal (expense/asset)</option>
              <option value="CREDIT">Credit-normal (revenue/liability)</option>
            </select>
            <button type="submit" disabled={submitting}>
              {submitting ? "Adding…" : "Add account"}
            </button>
          </div>
        </form>
      </div>
      {loading ? (
        <p>Loading…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Class</th>
              <th>Normal Balance</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {tree.map((root) => (
              <AccountRow key={root.id} node={root} depth={0} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
