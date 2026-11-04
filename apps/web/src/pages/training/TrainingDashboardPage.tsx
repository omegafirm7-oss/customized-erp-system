import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiClient } from "../../api/client";
import { BatchStatus, BatchStatusBadge, errMsg, fmtDate } from "./trainingShared";

interface Dashboard {
  courses: number;
  trainees: number;
  upcomingBatches: number;
  runningBatches: number;
  validCerts: number;
  expiring30: number;
  expiring90: number;
  expired: number;
  nextBatches: Array<{
    id: string;
    batchNo: string;
    startDate: string;
    endDate: string;
    venue: string | null;
    capacity: number | null;
    status: BatchStatus;
    course: { code: string; name: string };
    _count: { enrollments: number };
  }>;
}

export function TrainingDashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    apiClient
      .get<Dashboard>("/training/dashboard")
      .then((r) => setData(r.data))
      .catch((e) => setError(errMsg(e, "Failed to load training dashboard")));
  }, []);

  const tiles = data
    ? [
        { label: "Active courses", value: data.courses, to: "/training/courses" },
        { label: "Trainees", value: data.trainees, to: "/training/trainees" },
        { label: "Upcoming batches", value: data.upcomingBatches, to: "/training/batches?status=SCHEDULED" },
        { label: "Running now", value: data.runningBatches, to: "/training/batches?status=IN_PROGRESS" },
        { label: "Valid certificates", value: data.validCerts, to: "/training/certificates?view=VALID" },
        { label: "Expiring ≤ 30 days", value: data.expiring30, to: "/training/certificates?view=30" },
        { label: "Expiring ≤ 90 days", value: data.expiring90, to: "/training/certificates?view=90" },
        { label: "Expired", value: data.expired, to: "/training/certificates?view=EXPIRED" },
      ]
    : [];

  return (
    <div>
      <div className="card">
        <h2>Training</h2>
        <p className="trn-muted">Safety-card training: courses, trainees, classroom batches and certificates.</p>
        {error && <div className="error-banner">{error}</div>}
        {!data && !error && <p>Loading…</p>}
        {data && (
          <div className="kpi-grid">
            {tiles.map((t) => (
              <button key={t.label} className="kpi-tile" onClick={() => navigate(t.to)}>
                <span className="kpi-label">{t.label}</span>
                <span className="kpi-value">{t.value}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {data && (
        <div className="card">
          <div className="trn-header">
            <h3>Upcoming &amp; running batches</h3>
            <Link to="/training/batches">All batches →</Link>
          </div>
          {data.nextBatches.length === 0 ? (
            <p className="trn-muted">No upcoming batches. Create one from Batches.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Course</th>
                  <th>Dates</th>
                  <th>Venue</th>
                  <th>Enrolled</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.nextBatches.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link to={`/training/batches/${b.id}`}>{b.batchNo}</Link>
                    </td>
                    <td>{b.course.name}</td>
                    <td>
                      {fmtDate(b.startDate)} – {fmtDate(b.endDate)}
                    </td>
                    <td>{b.venue ?? "—"}</td>
                    <td>
                      {b._count.enrollments}
                      {b.capacity ? ` / ${b.capacity}` : ""}
                    </td>
                    <td>
                      <BatchStatusBadge status={b.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
