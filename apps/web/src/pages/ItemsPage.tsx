import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiClient } from "../api/client";

interface Item {
  id: string;
  code: string;
  name: string;
  itemType: string;
  vatCategory: string;
  isActive: boolean;
}

interface Uom {
  id: string;
  code: string;
  name: string;
}

interface Account {
  id: string;
  code: string;
  name: string;
  isPostable: boolean;
}

export function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [uoms, setUoms] = useState<Uom[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    code: "",
    name: "",
    itemType: "SERVICE",
    baseUoMId: "",
    vatCategory: "STANDARD_15",
    defaultSalesAccountId: "",
    defaultPurchaseAccountId: "",
    isInventoryItem: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [itemsRes, uomsRes, accountsRes] = await Promise.all([
        apiClient.get<Item[]>("/items"),
        apiClient.get<Uom[]>("/uoms"),
        apiClient.get<Account[]>("/coa/accounts"),
      ]);
      setItems(itemsRes.data);
      setUoms(uomsRes.data);
      setAccounts(accountsRes.data.filter((a) => a.isPostable));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function ensureUom(): Promise<string> {
    if (form.baseUoMId) return form.baseUoMId;
    if (uoms.length > 0) return uoms[0].id;
    const res = await apiClient.post("/uoms", { code: "EA", name: "Each" });
    return res.data.id;
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const baseUoMId = await ensureUom();
      await apiClient.post("/items", {
        code: form.code,
        name: form.name,
        itemType: form.itemType,
        baseUoMId,
        vatCategory: form.vatCategory,
        isInventoryItem: form.itemType === "INVENTORY" ? true : form.isInventoryItem,
        defaultSalesAccountId: form.defaultSalesAccountId || undefined,
        defaultPurchaseAccountId: form.defaultPurchaseAccountId || undefined,
      });
      setForm({ ...form, code: "", name: "" });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create item");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>Items</h2>
        {loading ? (
          <p>Loading…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Type</th>
                <th>VAT Category</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.code}</td>
                  <td>{item.name}</td>
                  <td>{item.itemType}</td>
                  <td>{item.vatCategory}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>New item</h3>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={handleCreate}>
          <div className="form-row">
            <input placeholder="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
            <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required style={{ flex: 1 }} />
            <select
              value={form.itemType}
              onChange={(e) =>
                setForm({ ...form, itemType: e.target.value, isInventoryItem: e.target.value === "INVENTORY" })
              }
            >
              <option value="SERVICE">Service</option>
              <option value="INVENTORY">Inventory (tracked stock)</option>
              <option value="NON_INVENTORY">Non-inventory</option>
            </select>
            <select value={form.vatCategory} onChange={(e) => setForm({ ...form, vatCategory: e.target.value })}>
              <option value="STANDARD_15">Standard 15%</option>
              <option value="ZERO_RATED">Zero-rated</option>
              <option value="EXEMPT">Exempt</option>
            </select>
          </div>
          <div className="form-row">
            <select value={form.defaultSalesAccountId} onChange={(e) => setForm({ ...form, defaultSalesAccountId: e.target.value })}>
              <option value="">Default sales account…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
            <select
              value={form.defaultPurchaseAccountId}
              onChange={(e) => setForm({ ...form, defaultPurchaseAccountId: e.target.value })}
            >
              <option value="">Default purchase account…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
            <button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
