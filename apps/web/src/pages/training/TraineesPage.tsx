import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiClient } from "../../api/client";
import { TraineeFormModal } from "./TraineeForm";
import { Trainee, employerLabel, errMsg, useTrainingPermissions } from "./trainingShared";

export function TraineesPage() {
  const { canManage } = useTrainingPermissions();
  const navigate = useNavigate();
  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback((term: string) => {
    setLoading(true);
    return apiClient
      .get<Trainee[]>("/training/trainees", { params: { q: term || undefined } })
      .then((r) => setTrainees(r.data))
      .catch((e) => setError(errMsg(e, "Failed to load trainees")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(q), 250);
    return () => clearTimeout(t);
  }, [q, load]);

  return (
    <div className="card">
      <div className="trn-header">
        <div>
          <h2>Trainees</h2>
          <p className="trn-muted">Workers who attend Red Dune training, with their employer and certificates.</p>
        </div>
        {canManage && <button onClick={() => setCreating(true)}>+ New trainee</button>}
      </div>
      {error && <div className="error-banner">{error}</div>}
      <div className="trn-toolbar">
        <input className="trn-grow" placeholder="Search name, ID number, phone or employer…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {loading && trainees.length === 0 ? (
        <p>Loading…</p>
      ) : trainees.length === 0 ? (
        <p className="trn-muted">{q ? "No trainees match your search." : "No trainees yet."}</p>
      ) : (
        <div className="trn-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>ID</th>
                <th>Nationality</th>
                <th>Mobile</th>
                <th>Employer</th>
                <th>Trade</th>
                <th>Courses</th>
                <th>Certificates</th>
              </tr>
            </thead>
            <tbody>
              {trainees.map((t) => (
                <tr key={t.id} style={t.isActive ? undefined : { opacity: 0.55 }}>
                  <td>
                    <Link to={`/training/trainees/${t.id}`}>{t.fullName}</Link>
                  </td>
                  <td>{t.idNumber}</td>
                  <td>{t.nationality ?? "—"}</td>
                  <td>{t.phone ?? "—"}</td>
                  <td>{employerLabel(t)}</td>
                  <td>{t.jobTitle ?? "—"}</td>
                  <td>{t._count?.enrollments ?? 0}</td>
                  <td>{t._count?.certificates ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && (
        <TraineeFormModal
          trainee={null}
          onClose={() => setCreating(false)}
          onSaved={(t) => {
            setCreating(false);
            navigate(`/training/trainees/${t.id}`);
          }}
        />
      )}
    </div>
  );
}
