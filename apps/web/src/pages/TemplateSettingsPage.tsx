import { FormEvent, useState } from "react";
import { apiClient } from "../api/client";
import { useTemplateSettings, TemplateSettings } from "../hooks/useTemplateSettings";

type FormState = Omit<
  TemplateSettings,
  "id" | "companyId" | "hasLogo" | "logoMimeType" | "updatedByUserId" | "createdAt" | "updatedAt"
>;

function toForm(s: TemplateSettings): FormState {
  return {
    headerTagline: s.headerTagline,
    headerMissionLine: s.headerMissionLine,
    accentColor: s.accentColor,
    footerText: s.footerText,
    showAddressInHeader: s.showAddressInHeader,
    showTaxNumberInHeader: s.showTaxNumberInHeader,
    timesheetTitle: s.timesheetTitle,
    timesheetShowIqama: s.timesheetShowIqama,
    timesheetShowDesignation: s.timesheetShowDesignation,
    salesShowItemCode: s.salesShowItemCode,
    salesShowVatBreakdown: s.salesShowVatBreakdown,
    salesTermsText: s.salesTermsText,
    purchaseShowItemCode: s.purchaseShowItemCode,
    purchaseShowVatBreakdown: s.purchaseShowVatBreakdown,
    purchaseTermsText: s.purchaseTermsText,
  };
}

export function TemplateSettingsPage() {
  const { settings, logoDataUrl, loading, reload } = useTemplateSettings();
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  if (loading && !settings) return <p>Loading…</p>;
  if (!settings) return <p>Failed to load template settings.</p>;
  const current = form ?? toForm(settings);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm({ ...current, [key]: value });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      await apiClient.patch("/settings/templates", current);
      await reload();
      setForm(null);
      setSaved(true);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to save template settings");
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File) {
    setError(null);
    setUploadingLogo(true);
    try {
      const body = new FormData();
      body.append("file", file);
      await apiClient.post("/settings/templates/logo", body, { headers: { "Content-Type": "multipart/form-data" } });
      await reload();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to upload logo — must be an image under 2MB");
    } finally {
      setUploadingLogo(false);
    }
  }

  async function removeLogo() {
    setError(null);
    try {
      await apiClient.delete("/settings/templates/logo");
      await reload();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to remove logo");
    }
  }

  return (
    <div className="card">
      <h2>Template Settings</h2>
      <p style={{ color: "#667085", fontSize: 13 }}>
        Branding and layout options used to generate PDFs across the app — the employee attendance sheet,
        and Sales/Purchase Quotations, Orders, and Invoices.
      </p>
      {error && <div className="error-banner">{error}</div>}
      {saved && <p style={{ color: "#027a48" }}>Saved.</p>}

      <h3>Branding</h3>
      <div className="form-row" style={{ alignItems: "center" }}>
        <div>
          <label>Logo </label>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {logoDataUrl ? (
              <img src={logoDataUrl} alt="Company logo" style={{ height: 48, border: "1px solid #d0d5dd", borderRadius: 4 }} />
            ) : (
              <span style={{ color: "#667085", fontSize: 13 }}>No logo uploaded</span>
            )}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={uploadingLogo}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadLogo(file);
                e.target.value = "";
              }}
            />
            {logoDataUrl && (
              <button type="button" className="secondary" onClick={removeLogo}>
                Remove
              </button>
            )}
          </div>
        </div>
      </div>
      <form onSubmit={save}>
        <div className="form-row">
          <div style={{ flex: 1 }}>
            <label>Header tagline (shown under company name, e.g. "CONSTRUCTION &amp; CONTRACTING SERVICES") </label>
            <input
              style={{ width: "100%" }}
              value={current.headerTagline ?? ""}
              onChange={(e) => set("headerTagline", e.target.value)}
            />
          </div>
        </div>
        <div className="form-row">
          <div style={{ flex: 1 }}>
            <label>Mission line (third header line, e.g. "Dune To Infrastructure") </label>
            <input
              style={{ width: "100%" }}
              value={current.headerMissionLine ?? ""}
              onChange={(e) => set("headerMissionLine", e.target.value)}
            />
          </div>
        </div>
        <div className="form-row">
          <div>
            <label>Accent color </label>
            <input type="color" value={current.accentColor} onChange={(e) => set("accentColor", e.target.value)} />
          </div>
          <div>
            <label>
              <input
                type="checkbox"
                checked={current.showAddressInHeader}
                onChange={(e) => set("showAddressInHeader", e.target.checked)}
              />{" "}
              Show company address in header
            </label>
          </div>
          <div>
            <label>
              <input
                type="checkbox"
                checked={current.showTaxNumberInHeader}
                onChange={(e) => set("showTaxNumberInHeader", e.target.checked)}
              />{" "}
              Show tax registration number in header
            </label>
          </div>
        </div>
        <div className="form-row">
          <div style={{ flex: 1 }}>
            <label>Footer text (all documents) </label>
            <input
              style={{ width: "100%" }}
              placeholder="e.g. bank details, signature line"
              value={current.footerText ?? ""}
              onChange={(e) => set("footerText", e.target.value)}
            />
          </div>
        </div>

        <h3>Timesheet</h3>
        <div className="form-row">
          <div>
            <label>Document title </label>
            <input value={current.timesheetTitle} onChange={(e) => set("timesheetTitle", e.target.value)} />
          </div>
          <div>
            <label>
              <input
                type="checkbox"
                checked={current.timesheetShowIqama}
                onChange={(e) => set("timesheetShowIqama", e.target.checked)}
              />{" "}
              Show Iqama/National ID
            </label>
          </div>
          <div>
            <label>
              <input
                type="checkbox"
                checked={current.timesheetShowDesignation}
                onChange={(e) => set("timesheetShowDesignation", e.target.checked)}
              />{" "}
              Show designation/trade
            </label>
          </div>
        </div>

        <h3>Sales cycle (Quotation / Order / Invoice)</h3>
        <div className="form-row">
          <div>
            <label>
              <input
                type="checkbox"
                checked={current.salesShowItemCode}
                onChange={(e) => set("salesShowItemCode", e.target.checked)}
              />{" "}
              Show item code column
            </label>
          </div>
          <div>
            <label>
              <input
                type="checkbox"
                checked={current.salesShowVatBreakdown}
                onChange={(e) => set("salesShowVatBreakdown", e.target.checked)}
              />{" "}
              Show VAT breakdown
            </label>
          </div>
          <div style={{ flex: 1 }}>
            <label>Terms & conditions </label>
            <input
              style={{ width: "100%" }}
              value={current.salesTermsText ?? ""}
              onChange={(e) => set("salesTermsText", e.target.value)}
            />
          </div>
        </div>

        <h3>Purchase cycle (Quotation / Order / Invoice)</h3>
        <div className="form-row">
          <div>
            <label>
              <input
                type="checkbox"
                checked={current.purchaseShowItemCode}
                onChange={(e) => set("purchaseShowItemCode", e.target.checked)}
              />{" "}
              Show item code column
            </label>
          </div>
          <div>
            <label>
              <input
                type="checkbox"
                checked={current.purchaseShowVatBreakdown}
                onChange={(e) => set("purchaseShowVatBreakdown", e.target.checked)}
              />{" "}
              Show VAT breakdown
            </label>
          </div>
          <div style={{ flex: 1 }}>
            <label>Terms & conditions </label>
            <input
              style={{ width: "100%" }}
              value={current.purchaseTermsText ?? ""}
              onChange={(e) => set("purchaseTermsText", e.target.value)}
            />
          </div>
        </div>

        <button type="submit" disabled={saving} style={{ marginTop: 10 }}>
          {saving ? "Saving…" : "Save settings"}
        </button>
      </form>
    </div>
  );
}
