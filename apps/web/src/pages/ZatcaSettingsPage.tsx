import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiClient } from "../api/client";

interface ZatcaDevice {
  id: string;
  environment: "SANDBOX" | "SIMULATION" | "PRODUCTION";
  unitName: string;
  egsSerialNumber: string;
  status: string;
  failureReason: string | null;
  icvCounter: number;
  certificateExpiresAt: string | null;
  onboardedAt: string | null;
}

interface CompanyInfo {
  legalName: string;
  taxRegistrationNumber: string | null;
  crNumber: string | null;
  addressLine1: string | null;
  buildingNumber: string | null;
  district: string | null;
  city: string | null;
  postalCode: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  CREATED: "Created (CSR generated)",
  COMPLIANCE_CSID_ISSUED: "Compliance certificate issued",
  COMPLIANCE_CHECKED: "Compliance checks passed",
  ACTIVE: "Active — invoices are being submitted",
  FAILED: "Failed",
  REVOKED: "Revoked",
};

export function ZatcaSettingsPage() {
  const [devices, setDevices] = useState<ZatcaDevice[]>([]);
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboarding, setOnboarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unitName, setUnitName] = useState("ERP-EGS-1");
  const [environment, setEnvironment] = useState("SANDBOX");
  const [masterData, setMasterData] = useState({
    taxRegistrationNumber: "",
    crNumber: "",
    addressLine1: "",
    buildingNumber: "",
    district: "",
    city: "",
    postalCode: "",
  });
  const [savingMasterData, setSavingMasterData] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [devicesRes, companyRes] = await Promise.all([
        apiClient.get<ZatcaDevice[]>("/zatca/devices"),
        apiClient.get<CompanyInfo>("/companies/current"),
      ]);
      setDevices(devicesRes.data);
      setCompany(companyRes.data);
      setMasterData({
        taxRegistrationNumber: companyRes.data.taxRegistrationNumber ?? "",
        crNumber: companyRes.data.crNumber ?? "",
        addressLine1: companyRes.data.addressLine1 ?? "",
        buildingNumber: companyRes.data.buildingNumber ?? "",
        district: companyRes.data.district ?? "",
        city: companyRes.data.city ?? "",
        postalCode: companyRes.data.postalCode ?? "",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const masterDataComplete =
    /^3\d{13}3$/.test(masterData.taxRegistrationNumber) &&
    !!masterData.crNumber &&
    !!masterData.addressLine1 &&
    !!masterData.buildingNumber &&
    !!masterData.district &&
    !!masterData.city &&
    /^\d{5}$/.test(masterData.postalCode);

  async function saveMasterData(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSavingMasterData(true);
    try {
      await apiClient.patch("/companies/current", masterData);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to save company data");
    } finally {
      setSavingMasterData(false);
    }
  }

  async function handleOnboard() {
    setError(null);
    setOnboarding(true);
    try {
      const res = await apiClient.post("/zatca/devices/onboard", { environment, unitName });
      if (res.data.complianceResults) {
        setError("Compliance checks failed — see device status for details");
      }
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Onboarding failed");
    } finally {
      setOnboarding(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>ZATCA e-Invoicing (Fatoora)</h2>
        <p>
          Onboard this company as an e-invoice generation solution (EGS). Standard (B2B) invoices are cleared in
          real time; simplified (B2C) invoices carry a QR code and are reported to ZATCA.
        </p>
      </div>

      <div className="card">
        <h3>1. Company master data (ZATCA-mandatory)</h3>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={saveMasterData}>
          <div className="form-row">
            <input
              placeholder="VAT number (3…3, 15 digits)"
              value={masterData.taxRegistrationNumber}
              onChange={(e) => setMasterData({ ...masterData, taxRegistrationNumber: e.target.value })}
              style={{ width: 220 }}
            />
            <input placeholder="CR number" value={masterData.crNumber} onChange={(e) => setMasterData({ ...masterData, crNumber: e.target.value })} />
          </div>
          <div className="form-row">
            <input placeholder="Street" value={masterData.addressLine1} onChange={(e) => setMasterData({ ...masterData, addressLine1: e.target.value })} style={{ flex: 1 }} />
            <input placeholder="Building no. (4 digits)" value={masterData.buildingNumber} onChange={(e) => setMasterData({ ...masterData, buildingNumber: e.target.value })} style={{ width: 160 }} />
            <input placeholder="District" value={masterData.district} onChange={(e) => setMasterData({ ...masterData, district: e.target.value })} />
            <input placeholder="City" value={masterData.city} onChange={(e) => setMasterData({ ...masterData, city: e.target.value })} style={{ width: 120 }} />
            <input placeholder="Postal (5 digits)" value={masterData.postalCode} onChange={(e) => setMasterData({ ...masterData, postalCode: e.target.value })} style={{ width: 130 }} />
          </div>
          <div className="form-row" style={{ justifyContent: "space-between" }}>
            <span className={masterDataComplete ? "balance-ok" : "balance-bad"}>
              {masterDataComplete ? "✓ Master data complete" : "Master data incomplete — required before onboarding"}
            </span>
            <button type="submit" disabled={savingMasterData}>
              {savingMasterData ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h3>2. Device onboarding</h3>
        <div className="form-row">
          <select value={environment} onChange={(e) => setEnvironment(e.target.value)}>
            <option value="SANDBOX">Sandbox (testing, no real OTP)</option>
            <option value="SIMULATION">Simulation (Fatoora portal OTP)</option>
            <option value="PRODUCTION">Production (Fatoora portal OTP)</option>
          </select>
          <input placeholder="Unit name" value={unitName} onChange={(e) => setUnitName(e.target.value)} />
          <button onClick={handleOnboard} disabled={onboarding || !masterDataComplete}>
            {onboarding ? "Onboarding… (CSR → CSID → 6 compliance checks → activate)" : "Onboard device"}
          </button>
        </div>

        {loading ? (
          <p>Loading…</p>
        ) : devices.length === 0 ? (
          <p>No devices yet. ZATCA submission is inactive for this company until a device is onboarded.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Environment</th>
                <th>Unit</th>
                <th>EGS Serial</th>
                <th>Status</th>
                <th>Invoices (ICV)</th>
                <th>Cert Expires</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id}>
                  <td>{d.environment}</td>
                  <td>{d.unitName}</td>
                  <td style={{ fontSize: 11 }}>{d.egsSerialNumber}</td>
                  <td>
                    <span className={`badge ${d.status === "ACTIVE" ? "posted" : d.status === "FAILED" ? "reversed" : "draft"}`}>
                      {STATUS_LABELS[d.status] ?? d.status}
                    </span>
                    {d.failureReason && <div style={{ fontSize: 11, color: "#912018", marginTop: 4 }}>{d.failureReason.slice(0, 200)}</div>}
                  </td>
                  <td>{d.icvCounter}</td>
                  <td>{d.certificateExpiresAt ? new Date(d.certificateExpiresAt).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {company && (
        <div className="card" style={{ fontSize: 13, color: "#667085" }}>
          <strong>Note:</strong> Standard (B2B) invoice XML may only be shared with buyers after ZATCA clearance.
          Rejected submissions require a credit note and corrected re-issue — the accounting posting itself is never
          rolled back.
        </div>
      )}
    </div>
  );
}
