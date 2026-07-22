import { useEffect, useState } from "react";
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

  useEffect(() => {
    apiClient
      .get<Account[]>("/coa/accounts")
      .then((res) => setAccounts(res.data))
      .finally(() => setLoading(false));
  }, []);

  const tree = buildTree(accounts);

  return (
    <div className="card">
      <h2>Chart of Accounts</h2>
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
