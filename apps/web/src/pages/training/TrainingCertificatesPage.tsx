import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useCanDownload } from "../../hooks/useCanDownload";
import { certificateVerifyUrl, downloadCertificatePdf } from "../../utils/certificatePdf";
import { CertStatus, CertStatusBadge, Modal, employerLabel, errMsg, fmtDate, useTrainingPermissions } from "./trainingShared";

interface CertRow {
  id: string;
  certificateNo: string;
  issueDate: string;
  expiryDate: string;
  externalCardNo: string | null;
  verifyToken: string;
  revokedReason: string | null;
  effectiveStatus: CertStatus;
  daysToExpiry: number;
  course: { id: string; code: string; name: string };
  trainee: { id: string; fullName: string; idNumber: string; phone: string | null; employerName: string | null; employerPartner: { name: string } | null };
  enrollment: { batch: { id: string; batchNo: string } };
}

const VIEWS = [
  { key: "", label: "All" },
  { key: "VALID", label: "Valid" },
  { key: "30", label: "Expiring ≤ 30 days" },
  { key: "60", label: "≤ 60 days" },
  { key: "90", label: "≤ 90 days" },
  { key: "EXPIRED", label: "Expired" },
  { key: "REVOKED", label: "Revoked" },
];

export function TrainingCertificatesPage() {
  const { canManage } = useTrainingPermissions();
  const canDownload = useCanDownload();
  const [params, setParams] = useSearchParams();
  const view = params.get("view") ?? "";
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<CertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cardEdit, setCardEdit] = useState<CertRow | null>(null);
  const [cardNo, setCardNo] = useState("");
  const [revoking, setRevoking] = useState<CertRow | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    (term: string) => {
      setLoading(true);
      const isDays = /^\d+$/.test(view);
      return apiClient
        .get<CertRow[]>("/training/certificates", {
          params: { status: !isDays && view ? view : undefined, expiringWithinDays: isDays ? view : undefined, q: term || undefined },
        })
        .then((r) => setRows(r.data))
        .catch((e) => setError(errMsg(e, "Failed to load certificates")))
        .finally(() => setLoading(false));
    },
    [view],
  );

  useEffect(() => {
    const t = setTimeout(() => load(q), 250);
    return () => clearTimeout(t);
  }, [q, load]);

  function setView(key: string) {
    const next = new URLSearchParams(params);
    if (key) next.set("view", key);
    else next.delete("view");
    setParams(next, { replace: true });
  }

  async function saveCard(e: FormEvent) {
    e.preventDefault();
    if (!cardEdit) return;
    setBusy(true);
    try {
      await apiClient.patch(`/training/certificates/${cardEdit.id}`, { externalCardNo: cardNo.trim() || null });
      setCardEdit(null);
      await load(q);
    } catch (err) {
      setError(errMsg(err, "Failed to save card number"));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(e: FormEvent) {
    e.preventDefault();
    if (!revoking) return;
    setBusy(true);
    try {
      await apiClient.post(`/training/certificates/${revoking.id}/revoke`, { reason });
      setRevoking(null);
      setReason("");
      await load(q);
    } catch (err) {
      setError(errMsg(err, "Failed to revoke certificate"));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(token: string) {
    await navigator.clipboard.writeText(certificateVerifyUrl(token));
    setNotice("Verification link copied.");
  }

  async function pdf(id: string) {
    try {
      await downloadCertificatePdf(id);
    } catch (e) {
      setError(errMsg(e, "Failed to create certificate PDF"));
    }
  }

  return (
    <div className="card">
      <div className="trn-header">
        <div>
          <h2>Certificates</h2>
          <p className="trn-muted">Issued certificates, expiry tracking and renewals. Each certificate's QR code opens a public verification page.</p>
        </div>
      </div>
      {error && <div className="error-banner">{error}</div>}
      {notice && (
        <div style={{ background: "#ecfdf3", color: "#05603a", padding: "8px 12px", borderRadius: 6, marginBottom: 12, fontSize: 13 }} onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}
      <div className="tab-row">
        {VIEWS.map((v) => (
          <button key={v.key} className={view === v.key ? "" : "secondary"} onClick={() => setView(v.key)}>
            {v.label}
          </button>
        ))}
      </div>
      <div className="trn-toolbar">
        <input className="trn-grow" placeholder="Search certificate no., card no., trainee, ID or employer…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {loading && rows.length === 0 ? (
        <p>Loading…</p>
      ) : rows.length === 0 ? (
        <p className="trn-muted">No certificates in this view.</p>
      ) : (
        <div className="trn-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Certificate</th>
                <th>Trainee</th>
                <th>Employer</th>
                <th>Mobile</th>
                <th>Course</th>
                <th>Card no.</th>
                <th>Issued</th>
                <th>Expires</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.certificateNo}
                    <div className="trn-muted">
                      <Link to={`/training/batches/${c.enrollment.batch.id}`}>{c.enrollment.batch.batchNo}</Link>
                    </div>
                  </td>
                  <td>
                    <Link to={`/training/trainees/${c.trainee.id}`}>{c.trainee.fullName}</Link>
                    <div className="trn-muted">{c.trainee.idNumber}</div>
                  </td>
                  <td>{employerLabel(c.trainee)}</td>
                  <td>{c.trainee.phone ?? "—"}</td>
                  <td>{c.course.name}</td>
                  <td>{c.externalCardNo ?? "—"}</td>
                  <td>{fmtDate(c.issueDate)}</td>
                  <td>{fmtDate(c.expiryDate)}</td>
                  <td>
                    <CertStatusBadge status={c.effectiveStatus} daysToExpiry={c.daysToExpiry} />
                    {c.revokedReason && <div className="trn-muted">{c.revokedReason}</div>}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {canDownload && (
                      <button className="secondary" onClick={() => pdf(c.id)}>
                        PDF
                      </button>
                    )}{" "}
                    <button className="secondary" onClick={() => copyLink(c.verifyToken)} title="Copy public verification link">
                      Link
                    </button>{" "}
                    {canManage && c.effectiveStatus !== "REVOKED" && (
                      <>
                        <button
                          className="secondary"
                          onClick={() => {
                            setCardEdit(c);
                            setCardNo(c.externalCardNo ?? "");
                          }}
                          title="Record the card number issued by TUV / the certifying body"
                        >
                          Card no.
                        </button>{" "}
                        <button className="secondary" onClick={() => setRevoking(c)}>
                          Revoke
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cardEdit && (
        <Modal title={`Card number · ${cardEdit.certificateNo}`} onClose={() => setCardEdit(null)}>
          <form onSubmit={saveCard}>
            <div className="trn-form-grid">
              <label className="trn-span-all">
                Card number from TUV / certifying body
                <input maxLength={60} value={cardNo} onChange={(e) => setCardNo(e.target.value)} autoFocus />
              </label>
            </div>
            <div className="trn-form-actions">
              <button type="button" className="secondary" onClick={() => setCardEdit(null)}>
                Cancel
              </button>
              <button type="submit" disabled={busy}>
                Save
              </button>
            </div>
          </form>
        </Modal>
      )}
      {revoking && (
        <Modal title={`Revoke ${revoking.certificateNo}`} onClose={() => setRevoking(null)}>
          <form onSubmit={revoke}>
            <p>
              Revoking marks the certificate of <b>{revoking.trainee.fullName}</b> as invalid. Its verification page will show <b>Revoked</b>. This can't be undone.
            </p>
            <div className="trn-form-grid">
              <label className="trn-span-all">
                Reason *
                <input required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
              </label>
            </div>
            <div className="trn-form-actions">
              <button type="button" className="secondary" onClick={() => setRevoking(null)}>
                Cancel
              </button>
              <button type="submit" disabled={busy}>
                Revoke certificate
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
