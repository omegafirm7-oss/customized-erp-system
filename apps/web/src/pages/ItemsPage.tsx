import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiClient } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { defaultTaxCategory, HS_CODE_PATTERN, TAX_CATEGORY_LABELS, taxOptionsFor } from "../utils/taxLocale";

interface Item {
  id: string;
  code: string;
  name: string;
  itemType: string;
  vatCategory: string;
  isActive: boolean;
  hsCode: string | null;
  fbrUom: string | null;
  fbrSaleType: string | null;
  reducedRate: string | null;
  retailPrice: string | null;
  sroScheduleNo: string | null;
  sroItemSerialNo: string | null;
  defaultSalesPrice: string | null;
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

// Pakistan (FBR) item fields — shared by the create form and the inline editor.
interface PkFields {
  hsCode: string;
  fbrUom: string;
  fbrSaleType: string;
  reducedRate: string;
  retailPrice: string;
  sroScheduleNo: string;
  sroItemSerialNo: string;
  defaultSalesPrice: string;
}

const EMPTY_PK: PkFields = { hsCode: "", fbrUom: "", fbrSaleType: "", reducedRate: "", retailPrice: "", sroScheduleNo: "", sroItemSerialNo: "", defaultSalesPrice: "" };

/** Only send filled-in PK fields (the API validates formats). */
function pkPayload(fields: PkFields) {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== ""));
}

function errorText(err: any, fallback: string) {
  const m = err?.response?.data?.message;
  return Array.isArray(m) ? m.join("; ") : m ?? fallback;
}

function PkItemFields({ category, value, onChange }: { category: string; value: PkFields; onChange: (v: PkFields) => void }) {
  return (
    <div className="form-row">
      <label className="stacked-label">
        HS / PCT code (required for FBR)
        <input
          placeholder="8414.5100"
          pattern={HS_CODE_PATTERN}
          title='Format "####.####"'
          value={value.hsCode}
          onChange={(e) => onChange({ ...value, hsCode: e.target.value })}
          style={{ width: 120 }}
        />
      </label>
      <label className="stacked-label">
        Price incl. tax (POS)
        <input inputMode="decimal" value={value.defaultSalesPrice} onChange={(e) => onChange({ ...value, defaultSalesPrice: e.target.value })} style={{ width: 100 }} />
      </label>
      <label className="stacked-label">
        FBR unit of measure
        <input placeholder="Numbers, pieces, units" value={value.fbrUom} onChange={(e) => onChange({ ...value, fbrUom: e.target.value })} />
      </label>
      <label className="stacked-label">
        Sale type override
        <select value={value.fbrSaleType} onChange={(e) => onChange({ ...value, fbrSaleType: e.target.value })}>
          <option value="">From tax category</option>
          <option value="Services">Services</option>
        </select>
      </label>
      {category === "PK_REDUCED" && (
        <label className="stacked-label">
          Reduced rate %
          <input required inputMode="decimal" value={value.reducedRate} onChange={(e) => onChange({ ...value, reducedRate: e.target.value })} style={{ width: 80 }} />
        </label>
      )}
      {category === "PK_THIRD_SCHEDULE" && (
        <label className="stacked-label">
          Printed retail price (per unit)
          <input required inputMode="decimal" value={value.retailPrice} onChange={(e) => onChange({ ...value, retailPrice: e.target.value })} style={{ width: 110 }} />
        </label>
      )}
      {(category === "PK_REDUCED" || category === "EXEMPT" || category === "ZERO_RATED") && (
        <>
          <label className="stacked-label">
            SRO / schedule no.
            <input value={value.sroScheduleNo} onChange={(e) => onChange({ ...value, sroScheduleNo: e.target.value })} style={{ width: 130 }} />
          </label>
          <label className="stacked-label">
            SRO item serial
            <input value={value.sroItemSerialNo} onChange={(e) => onChange({ ...value, sroItemSerialNo: e.target.value })} style={{ width: 90 }} />
          </label>
        </>
      )}
    </div>
  );
}

export function ItemsPage() {
  const { user } = useAuth();
  const countryCode = user?.countryCode ?? null;
  const isPakistan = countryCode === "PK";
  const taxOptions = taxOptionsFor(countryCode);
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
    vatCategory: defaultTaxCategory(countryCode) as string,
    defaultSalesAccountId: "",
    defaultPurchaseAccountId: "",
    isInventoryItem: false,
  });
  const [pk, setPk] = useState<PkFields>(EMPTY_PK);
  const [editing, setEditing] = useState<{ id: string; vatCategory: string; fields: PkFields } | null>(null);

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
        ...(isPakistan ? pkPayload(pk) : {}),
      });
      setForm({ ...form, code: "", name: "" });
      setPk(EMPTY_PK);
      await load();
    } catch (err: any) {
      setError(errorText(err, "Failed to create item"));
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(item: Item) {
    setEditing({
      id: item.id,
      vatCategory: item.vatCategory,
      fields: {
        hsCode: item.hsCode ?? "",
        fbrUom: item.fbrUom ?? "",
        fbrSaleType: item.fbrSaleType ?? "",
        reducedRate: item.reducedRate ?? "",
        retailPrice: item.retailPrice ?? "",
        sroScheduleNo: item.sroScheduleNo ?? "",
        sroItemSerialNo: item.sroItemSerialNo ?? "",
        defaultSalesPrice: item.defaultSalesPrice ? String(Number(item.defaultSalesPrice)) : "",
      },
    });
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setError(null);
    try {
      await apiClient.patch(`/items/${editing.id}`, { vatCategory: editing.vatCategory, ...pkPayload(editing.fields) });
      setEditing(null);
      await load();
    } catch (err: any) {
      setError(errorText(err, "Failed to update item"));
    }
  }

  const missingHs = isPakistan ? items.filter((i) => i.isActive && !i.hsCode).length : 0;

  return (
    <div>
      <div className="card">
        <h2>Items</h2>
        {missingHs > 0 && (
          <div className="error-banner">
            {missingHs} active item{missingHs === 1 ? " has" : "s have"} no HS code. FBR rejects invoices for these items, so
            posting is blocked until an HS code is added.
          </div>
        )}
        {loading ? (
          <p>Loading…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Type</th>
                <th>{isPakistan ? "Sales tax" : "VAT Category"}</th>
                {isPakistan && <th>HS code</th>}
                {isPakistan && <th />}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.code}</td>
                  <td>{item.name}</td>
                  <td>{item.itemType}</td>
                  <td>
                    {TAX_CATEGORY_LABELS[item.vatCategory] ?? item.vatCategory}
                    {item.vatCategory === "PK_REDUCED" && item.reducedRate && ` — ${Number(item.reducedRate)}%`}
                    {item.vatCategory === "PK_THIRD_SCHEDULE" && item.retailPrice && ` — RP ${Number(item.retailPrice)}`}
                  </td>
                  {isPakistan && <td>{item.hsCode ?? <span className="badge reversed">missing</span>}</td>}
                  {isPakistan && (
                    <td>
                      <button className="secondary" onClick={() => startEdit(item)}>FBR details</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <div className="card">
          <h3>FBR details — {items.find((i) => i.id === editing.id)?.name}</h3>
          <form onSubmit={saveEdit}>
            <div className="form-row">
              <label className="stacked-label">
                Sales tax category
                <select value={editing.vatCategory} onChange={(e) => setEditing({ ...editing, vatCategory: e.target.value })}>
                  {taxOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <PkItemFields category={editing.vatCategory} value={editing.fields} onChange={(fields) => setEditing({ ...editing, fields })} />
            <div className="form-row">
              <button type="submit">Save</button>
              <button type="button" className="secondary" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

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
              {taxOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          {isPakistan && <PkItemFields category={form.vatCategory} value={pk} onChange={setPk} />}
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
