import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiClient } from "../api/client";
import { FBR_BUSINESS_ACTIVITIES, FBR_SECTORS, NTN_CNIC_PATTERN, PK_PROVINCES } from "../utils/taxLocale";

type FbrEnvironment = "MOCK" | "SANDBOX" | "PRODUCTION";

interface FbrSettings {
  company: {
    countryCode: string;
    ntn: string | null;
    strn: string | null;
    province: string | null;
    fbrBusinessActivity: string | null;
    fbrSector: string | null;
  };
  enabled: boolean;
  environment: FbrEnvironment;
  hasDiToken: boolean;
  hasPosToken: boolean;
  furtherTaxRatePercent: string;
  posFeeAmount: string;
  servicesTaxRatePercent: string;
  posFeeAccountId: string | null;
}

interface Account {
  id: string;
  code: string;
  name: string;
  isPostable: boolean;
}

const ENVIRONMENT_HELP: Record<FbrEnvironment, string> = {
  MOCK: "Test mode — nothing leaves this server. Invoices get simulated FBR numbers and are NOT reported to FBR.",
  SANDBOX: "PRAL sandbox — real FBR validation, sandbox token. Use it to pass the scenario tests before go-live.",
  PRODUCTION: "Live — every posted sales invoice and POS sale is legally reported to FBR.",
};

function errorMessage(err: any, fallback: string) {
  const message = err?.response?.data?.message;
  return Array.isArray(message) ? message.join("; ") : message ?? fallback;
}

export function FbrSettingsPage() {
  const [settings, setSettings] = useState<FbrSettings | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [company, setCompany] = useState({ ntn: "", strn: "", province: "", fbrBusinessActivity: "", fbrSector: "", addressLine1: "", city: "" });
  const [form, setForm] = useState({
    enabled: false,
    environment: "MOCK" as FbrEnvironment,
    diToken: "",
    posToken: "",
    furtherTaxRatePercent: "4",
    posFeeAmount: "1",
    servicesTaxRatePercent: "15",
    posFeeAccountId: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    const [settingsRes, companyRes, accountsRes] = await Promise.all([
      apiClient.get<FbrSettings>("/fbr/settings"),
      apiClient.get("/companies/current"),
      apiClient.get<Account[]>("/coa/accounts"),
    ]);
    const s = settingsRes.data;
    setSettings(s);
    setAccounts(accountsRes.data.filter((a) => a.isPostable));
    setCompany({
      ntn: companyRes.data.ntn ?? "",
      strn: companyRes.data.strn ?? "",
      province: companyRes.data.province ?? "",
      fbrBusinessActivity: companyRes.data.fbrBusinessActivity ?? "",
      fbrSector: companyRes.data.fbrSector ?? "",
      addressLine1: companyRes.data.addressLine1 ?? "",
      city: companyRes.data.city ?? "",
    });
    setForm((f) => ({
      ...f,
      enabled: s.enabled,
      environment: s.environment,
      diToken: "",
      posToken: "",
      furtherTaxRatePercent: s.furtherTaxRatePercent,
      posFeeAmount: s.posFeeAmount,
      servicesTaxRatePercent: s.servicesTaxRatePercent,
      posFeeAccountId: s.posFeeAccountId ?? "",
    }));
  }, []);

  useEffect(() => {
    load().catch((err) => setError(errorMessage(err, "Failed to load FBR settings")));
  }, [load]);

  async function saveCompany(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const payload = Object.fromEntries(Object.entries(company).filter(([, v]) => v !== ""));
      await apiClient.patch("/companies/current", payload);
      setNotice("Company FBR identity saved");
      await load();
    } catch (err) {
      setError(errorMessage(err, "Failed to save company details"));
    }
  }

  async function saveSettings(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      await apiClient.put("/fbr/settings", {
        enabled: form.enabled,
        environment: form.environment,
        furtherTaxRatePercent: form.furtherTaxRatePercent,
        posFeeAmount: form.posFeeAmount,
        servicesTaxRatePercent: form.servicesTaxRatePercent,
        posFeeAccountId: form.posFeeAccountId || null,
        // Only send tokens the user actually typed — blank means "keep".
        ...(form.diToken ? { diToken: form.diToken } : {}),
        ...(form.posToken ? { posToken: form.posToken } : {}),
      });
      setNotice("FBR settings saved");
      await load();
    } catch (err) {
      setError(errorMessage(err, "Failed to save FBR settings"));
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setError(null);
    setNotice(null);
    setTesting(true);
    try {
      const res = await apiClient.post("/fbr/settings/test-connection");
      if (res.data.ok) setNotice(`${res.data.environment}: ${res.data.message}`);
      else setError(`${res.data.environment}: ${res.data.message}`);
    } catch (err) {
      setError(errorMessage(err, "Connection test failed"));
    } finally {
      setTesting(false);
    }
  }

  if (!settings) {
    return <div className="card">{error ? <div className="error-banner">{error}</div> : "Loading…"}</div>;
  }

  if (settings.company.countryCode !== "PK") {
    return (
      <div className="card">
        <h2>FBR (Pakistan)</h2>
        <p>FBR reporting applies to Pakistan companies only. This company's country is {settings.company.countryCode}.</p>
      </div>
    );
  }

  const identityComplete = !!(settings.company.ntn && settings.company.province && settings.company.fbrBusinessActivity);

  return (
    <div>
      <div className="card">
        <h2>FBR — Digital Invoicing &amp; POS Integration</h2>
        <p>
          When enabled, every posted sales invoice is reported to FBR Digital Invoicing (PRAL) and every sale from a
          registered POS terminal to FBR's POS system (IMS). FBR's invoice number and QR code are then printed on the
          invoice or receipt. If FBR is unreachable the posting still goes through, and the submission is retried
          automatically.
        </p>
        <p>
          Status:{" "}
          <strong>{settings.enabled ? `Enabled (${settings.environment})` : "Disabled"}</strong>
          {settings.enabled && settings.environment !== "PRODUCTION" && (
            <span className="badge warning" style={{ marginLeft: 8 }}>Not live — invoices are not legally reported</span>
          )}
        </p>
        {error && <div className="error-banner" style={{ whiteSpace: "pre-line" }}>{error}</div>}
        {notice && <div className="success-banner">{notice}</div>}
      </div>

      <div className="card">
        <h3>1. Seller identity (as registered with FBR)</h3>
        <form onSubmit={saveCompany}>
          <div className="form-row">
            <label className="stacked-label">
              NTN (7 digits) or CNIC (13)
              <input
                value={company.ntn}
                pattern={NTN_CNIC_PATTERN}
                title="7-digit NTN or 13-digit CNIC, digits only"
                onChange={(e) => setCompany({ ...company, ntn: e.target.value.replace(/\D/g, "") })}
              />
            </label>
            <label className="stacked-label">
              STRN
              <input value={company.strn} onChange={(e) => setCompany({ ...company, strn: e.target.value })} />
            </label>
            <label className="stacked-label">
              Province
              <select value={company.province} onChange={(e) => setCompany({ ...company, province: e.target.value })}>
                <option value="">Select…</option>
                {PK_PROVINCES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-row">
            <label className="stacked-label">
              Business activity
              <select value={company.fbrBusinessActivity} onChange={(e) => setCompany({ ...company, fbrBusinessActivity: e.target.value })}>
                <option value="">Select…</option>
                {FBR_BUSINESS_ACTIVITIES.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </label>
            <label className="stacked-label">
              Sector
              <select value={company.fbrSector} onChange={(e) => setCompany({ ...company, fbrSector: e.target.value })}>
                <option value="">Select…</option>
                {FBR_SECTORS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-row">
            <label className="stacked-label">
              Business address
              <input value={company.addressLine1} onChange={(e) => setCompany({ ...company, addressLine1: e.target.value })} style={{ minWidth: 260 }} />
            </label>
            <label className="stacked-label">
              City
              <input value={company.city} onChange={(e) => setCompany({ ...company, city: e.target.value })} />
            </label>
          </div>
          <button type="submit">Save seller identity</button>
        </form>
      </div>

      <div className="card">
        <h3>2. FBR connection</h3>
        {!identityComplete && <p className="muted">Complete the NTN, province and business activity above before enabling.</p>}
        <form onSubmit={saveSettings}>
          <div className="form-row">
            <label className="stacked-label">
              Environment
              <select value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value as FbrEnvironment })}>
                <option value="MOCK">Test (mock, offline)</option>
                <option value="SANDBOX">PRAL sandbox</option>
                <option value="PRODUCTION">Production (live)</option>
              </select>
            </label>
            <label className="stacked-label inline">
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
              Report invoices to FBR
            </label>
          </div>
          <p className="muted">{ENVIRONMENT_HELP[form.environment]}</p>
          <div className="form-row">
            <label className="stacked-label">
              Digital Invoicing token {settings.hasDiToken && <span className="badge">saved</span>}
              <input
                type="password"
                autoComplete="off"
                placeholder={settings.hasDiToken ? "•••••• (leave blank to keep)" : "Bearer token from PRAL / IRIS"}
                value={form.diToken}
                onChange={(e) => setForm({ ...form, diToken: e.target.value })}
                style={{ minWidth: 300 }}
              />
            </label>
            <label className="stacked-label">
              POS (IMS) token {settings.hasPosToken && <span className="badge">saved</span>}
              <input
                type="password"
                autoComplete="off"
                placeholder={settings.hasPosToken ? "•••••• (leave blank to keep)" : "Needed only for POS terminals"}
                value={form.posToken}
                onChange={(e) => setForm({ ...form, posToken: e.target.value })}
                style={{ minWidth: 300 }}
              />
            </label>
          </div>
          <div className="form-row">
            <label className="stacked-label">
              Further tax on unregistered buyers (%)
              <input value={form.furtherTaxRatePercent} inputMode="decimal" onChange={(e) => setForm({ ...form, furtherTaxRatePercent: e.target.value })} style={{ width: 90 }} />
            </label>
            <label className="stacked-label" title="E.g. Islamabad Capital Territory sales tax on services — confirm the current rate with your tax advisor">
              Sales tax on services (%)
              <input value={form.servicesTaxRatePercent} inputMode="decimal" onChange={(e) => setForm({ ...form, servicesTaxRatePercent: e.target.value })} style={{ width: 90 }} />
            </label>
            <label className="stacked-label">
              POS service fee per sale (Rs.)
              <input value={form.posFeeAmount} inputMode="decimal" onChange={(e) => setForm({ ...form, posFeeAmount: e.target.value })} style={{ width: 90 }} />
            </label>
            <label className="stacked-label">
              POS fee payable account
              <select value={form.posFeeAccountId} onChange={(e) => setForm({ ...form, posFeeAccountId: e.target.value })}>
                <option value="">Select liability account…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-row">
            <button type="submit" disabled={saving}>{saving ? "Saving…" : "Save FBR settings"}</button>
            <button type="button" className="secondary" disabled={testing} onClick={testConnection}>
              {testing ? "Testing…" : "Test connection"}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h3>3. Going live</h3>
        <ol>
          <li>Register for Digital Invoicing on IRIS; PRAL issues sandbox and production tokens (valid 5 years).</li>
          <li>Whitelist this server's public IP with PRAL.</li>
          <li>Switch to <strong>PRAL sandbox</strong>, paste the sandbox token and post test invoices for every scenario that applies to your business activity (see FBR Submissions).</li>
          <li>After FBR approves the scenarios, switch to <strong>Production</strong> with the production token.</li>
          <li>For Tier-1 retail, register each till on IRIS to get a POSID, then add it under POS Terminals.</li>
        </ol>
      </div>
    </div>
  );
}
