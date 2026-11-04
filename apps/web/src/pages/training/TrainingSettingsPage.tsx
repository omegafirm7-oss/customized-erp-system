import { FormEvent, useEffect, useState } from "react";
import { apiClient } from "../../api/client";
import { errMsg, useTrainingPermissions } from "./trainingShared";

interface Settings {
  certificatePrefix: string;
  nextCertificateNumber: number;
  signatoryName: string | null;
  signatoryTitle: string | null;
  certificateFooterText: string | null;
}

export function TrainingSettingsPage() {
  const { canManage } = useTrainingPermissions();
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiClient
      .get<Settings>("/training/settings")
      .then((r) => setS(r.data))
      .catch((e) => setError(errMsg(e, "Failed to load settings")));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!s) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const r = await apiClient.patch<Settings>("/training/settings", {
        certificatePrefix: s.certificatePrefix.trim(),
        signatoryName: s.signatoryName ?? "",
        signatoryTitle: s.signatoryTitle ?? "",
        certificateFooterText: s.certificateFooterText ?? "",
      });
      setS(r.data);
      setSaved(true);
    } catch (err) {
      setError(errMsg(err, "Failed to save settings"));
    } finally {
      setSaving(false);
    }
  }

  if (!s) return <div className="card">{error ? <div className="error-banner">{error}</div> : <p>Loading…</p>}</div>;

  const year = new Date().getFullYear();
  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <h2>Training settings</h2>
      <p className="trn-muted">Certificate numbering and the wording printed on certificates. Logo and accent colour come from Template Settings.</p>
      {error && <div className="error-banner">{error}</div>}
      <form onSubmit={save}>
        <fieldset disabled={!canManage} style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="trn-form-grid">
            <label>
              Certificate number prefix
              <input required maxLength={20} value={s.certificatePrefix} onChange={(e) => setS({ ...s, certificatePrefix: e.target.value })} />
            </label>
            <label>
              Next certificate number
              <input disabled value={`${s.certificatePrefix.trim().toUpperCase() || "CERT"}-${year}-${String(s.nextCertificateNumber).padStart(5, "0")}`} />
            </label>
            <label>
              Signatory name
              <input maxLength={120} value={s.signatoryName ?? ""} onChange={(e) => setS({ ...s, signatoryName: e.target.value })} placeholder="e.g. Training Manager's name" />
            </label>
            <label>
              Signatory title
              <input maxLength={120} value={s.signatoryTitle ?? ""} onChange={(e) => setS({ ...s, signatoryTitle: e.target.value })} placeholder="e.g. Training Manager" />
            </label>
            <label className="trn-span-all">
              Certificate footer text
              <textarea
                rows={2}
                maxLength={500}
                value={s.certificateFooterText ?? ""}
                onChange={(e) => setS({ ...s, certificateFooterText: e.target.value })}
                placeholder="e.g. Approval / accreditation wording, address, contact"
              />
            </label>
          </div>
          {canManage && (
            <div className="trn-form-actions">
              {saved && <span className="trn-muted" style={{ alignSelf: "center" }}>Saved.</span>}
              <button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          )}
        </fieldset>
      </form>
    </div>
  );
}
