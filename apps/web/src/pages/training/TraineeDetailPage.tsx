import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useCanDownload } from "../../hooks/useCanDownload";
import { downloadCertificatePdf } from "../../utils/certificatePdf";
import { TraineeFormModal } from "./TraineeForm";
import {
  BatchStatus,
  BatchStatusBadge,
  CertStatus,
  CertStatusBadge,
  ID_TYPES,
  Result,
  ResultBadge,
  Trainee,
  employerLabel,
  errMsg,
  fmtDate,
  useTrainingPermissions,
} from "./trainingShared";

interface TraineeDetail extends Trainee {
  enrollments: Array<{
    id: string;
    result: Result;
    theoryMarks: string | null;
    practicalMarks: string | null;
    batch: { id: string; batchNo: string; startDate: string; endDate: string; status: BatchStatus; course: { code: string; name: string } };
    certificate: { id: string; certificateNo: string } | null;
  }>;
  certificates: Array<{
    id: string;
    certificateNo: string;
    issueDate: string;
    expiryDate: string;
    externalCardNo: string | null;
    effectiveStatus: CertStatus;
    course: { code: string; name: string };
  }>;
}

export function TraineeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canManage } = useTrainingPermissions();
  const canDownload = useCanDownload();
  const [t, setT] = useState<TraineeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiClient.get<TraineeDetail>(`/training/trainees/${id}`);
      setT(r.data);
      if (r.data.photoMimeType) {
        const p = await apiClient.get(`/training/trainees/${id}/photo`, { responseType: "blob" });
        setPhotoUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(p.data as Blob);
        });
      } else {
        setPhotoUrl(null);
      }
    } catch (e) {
      setError(errMsg(e, "Failed to load trainee"));
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove() {
    if (!t || !confirm(`Delete trainee ${t.fullName}?`)) return;
    try {
      await apiClient.delete(`/training/trainees/${t.id}`);
      navigate("/training/trainees");
    } catch (e) {
      setError(errMsg(e, "Failed to delete trainee"));
    }
  }

  async function pdf(certId: string) {
    try {
      await downloadCertificatePdf(certId);
    } catch (e) {
      setError(errMsg(e, "Failed to create certificate PDF"));
    }
  }

  if (!t) return <div className="card">{error ? <div className="error-banner">{error}</div> : <p>Loading…</p>}</div>;

  return (
    <div>
      <div className="card">
        <p>
          <Link to="/training/trainees">← Trainees</Link>
        </p>
        {error && <div className="error-banner">{error}</div>}
        <div className="trn-header">
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
            {photoUrl ? <img className="trn-photo" src={photoUrl} alt="" /> : <div className="trn-photo trn-photo-empty">No photo</div>}
            <div>
              <h2>
                {t.fullName} {!t.isActive && <span className="badge reversed">Inactive</span>}
              </h2>
              {t.fullNameAr && (
                <div dir="rtl" className="trn-muted">
                  {t.fullNameAr}
                </div>
              )}
              <div className="trn-muted">
                {ID_TYPES.find((x) => x.value === t.idType)?.label ?? t.idType} {t.idNumber}
              </div>
            </div>
          </div>
          {canManage && (
            <div style={{ display: "flex", gap: 8 }}>
              <button className="secondary" onClick={() => setEditing(true)}>
                Edit
              </button>
              {t.enrollments.length === 0 && (
                <button className="secondary" onClick={remove}>
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
        <div className="trn-facts">
          <div>
            <span>Employer</span>
            {employerLabel(t)}
          </div>
          <div>
            <span>Trade</span>
            {t.jobTitle ?? "—"}
          </div>
          <div>
            <span>Nationality</span>
            {t.nationality ?? "—"}
          </div>
          <div>
            <span>Mobile</span>
            {t.phone ?? "—"}
          </div>
          <div>
            <span>Email</span>
            {t.email ?? "—"}
          </div>
          <div>
            <span>Date of birth</span>
            {fmtDate(t.dateOfBirth)}
          </div>
        </div>
        {t.notes && <p className="trn-muted">{t.notes}</p>}
      </div>

      <div className="card">
        <h3>Certificates</h3>
        {t.certificates.length === 0 ? (
          <p className="trn-muted">No certificates yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Certificate</th>
                <th>Course</th>
                <th>Card no.</th>
                <th>Issued</th>
                <th>Expires</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {t.certificates.map((c) => (
                <tr key={c.id}>
                  <td>{c.certificateNo}</td>
                  <td>{c.course.name}</td>
                  <td>{c.externalCardNo ?? "—"}</td>
                  <td>{fmtDate(c.issueDate)}</td>
                  <td>{fmtDate(c.expiryDate)}</td>
                  <td>
                    <CertStatusBadge status={c.effectiveStatus} />
                  </td>
                  <td>
                    {canDownload && (
                      <button className="secondary" onClick={() => pdf(c.id)}>
                        PDF
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>Training history</h3>
        {t.enrollments.length === 0 ? (
          <p className="trn-muted">Not enrolled in any batch yet. Enrol from a batch page.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Batch</th>
                <th>Course</th>
                <th>Dates</th>
                <th>Batch status</th>
                <th>Theory</th>
                <th>Practical</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {t.enrollments.map((e) => (
                <tr key={e.id}>
                  <td>
                    <Link to={`/training/batches/${e.batch.id}`}>{e.batch.batchNo}</Link>
                  </td>
                  <td>{e.batch.course.name}</td>
                  <td>
                    {fmtDate(e.batch.startDate)} – {fmtDate(e.batch.endDate)}
                  </td>
                  <td>
                    <BatchStatusBadge status={e.batch.status} />
                  </td>
                  <td>{e.theoryMarks ?? "—"}</td>
                  <td>{e.practicalMarks ?? "—"}</td>
                  <td>
                    <ResultBadge result={e.result} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <TraineeFormModal
          trainee={t}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            load();
          }}
        />
      )}
    </div>
  );
}
