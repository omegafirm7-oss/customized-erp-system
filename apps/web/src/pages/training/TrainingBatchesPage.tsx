import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiClient } from "../../api/client";
import { BATCH_STATUSES, BatchStatus, BatchStatusBadge, Course, Modal, errMsg, fmtDate, todayIso, useTrainingPermissions } from "./trainingShared";

interface BatchRow {
  id: string;
  batchNo: string;
  startDate: string;
  endDate: string;
  venue: string | null;
  instructorName: string | null;
  capacity: number | null;
  status: BatchStatus;
  course: { id: string; code: string; name: string };
  _count: { enrollments: number };
  passed: number;
  certified: number;
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function TrainingBatchesPage() {
  const { canManage } = useTrainingPermissions();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const courseId = params.get("courseId") ?? "";
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ courseId: "", startDate: todayIso(), endDate: todayIso(), venue: "", instructorName: "", capacity: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    return apiClient
      .get<BatchRow[]>("/training/batches", { params: { status: status || undefined, courseId: courseId || undefined } })
      .then((r) => setBatches(r.data))
      .catch((e) => setError(errMsg(e, "Failed to load batches")))
      .finally(() => setLoading(false));
  }, [status, courseId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    apiClient.get<Course[]>("/training/courses").then((r) => setCourses(r.data)).catch(() => undefined);
  }, []);

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  function pickCourse(id: string) {
    const c = courses.find((x) => x.id === id);
    setForm((f) => ({ ...f, courseId: id, endDate: c ? addDays(f.startDate, c.durationDays - 1) : f.endDate }));
  }

  function pickStart(start: string) {
    const c = courses.find((x) => x.id === form.courseId);
    setForm((f) => ({ ...f, startDate: start, endDate: c && start ? addDays(start, c.durationDays - 1) : f.endDate }));
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const r = await apiClient.post<{ id: string }>("/training/batches", {
        courseId: form.courseId,
        startDate: form.startDate,
        endDate: form.endDate,
        venue: form.venue.trim() || undefined,
        instructorName: form.instructorName.trim() || undefined,
        capacity: form.capacity ? Number(form.capacity) : undefined,
        notes: form.notes.trim() || undefined,
      });
      navigate(`/training/batches/${r.data.id}`);
    } catch (err) {
      setFormError(errMsg(err, "Failed to create batch"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <div className="trn-header">
        <div>
          <h2>Batches</h2>
          <p className="trn-muted">Classroom sessions of a course: enrol trainees, take attendance, enter marks, issue certificates.</p>
        </div>
        {canManage && (
          <button onClick={() => setCreating(true)} disabled={courses.length === 0} title={courses.length === 0 ? "Add a course first" : undefined}>
            + New batch
          </button>
        )}
      </div>
      {error && <div className="error-banner">{error}</div>}
      <div className="trn-toolbar">
        <select value={status} onChange={(e) => setFilter("status", e.target.value)}>
          <option value="">All statuses</option>
          {BATCH_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ").toLowerCase()}
            </option>
          ))}
        </select>
        <select value={courseId} onChange={(e) => setFilter("courseId", e.target.value)}>
          <option value="">All courses</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {loading ? (
        <p>Loading…</p>
      ) : batches.length === 0 ? (
        <p className="trn-muted">No batches found.</p>
      ) : (
        <div className="trn-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Batch</th>
                <th>Course</th>
                <th>Dates</th>
                <th>Venue</th>
                <th>Instructor</th>
                <th>Enrolled</th>
                <th>Passed</th>
                <th>Certified</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td>
                    <Link to={`/training/batches/${b.id}`}>{b.batchNo}</Link>
                  </td>
                  <td>{b.course.name}</td>
                  <td>
                    {fmtDate(b.startDate)}
                    {b.endDate !== b.startDate ? ` – ${fmtDate(b.endDate)}` : ""}
                  </td>
                  <td>{b.venue ?? "—"}</td>
                  <td>{b.instructorName ?? "—"}</td>
                  <td>
                    {b._count.enrollments}
                    {b.capacity ? ` / ${b.capacity}` : ""}
                  </td>
                  <td>{b.passed}</td>
                  <td>{b.certified}</td>
                  <td>
                    <BatchStatusBadge status={b.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <Modal title="New batch" onClose={() => setCreating(false)}>
          <form onSubmit={create}>
            {formError && <div className="error-banner">{formError}</div>}
            <div className="trn-form-grid">
              <label className="trn-span-all">
                Course *
                <select required value={form.courseId} onChange={(e) => pickCourse(e.target.value)}>
                  <option value="">Select a course…</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.durationDays} day{c.durationDays === 1 ? "" : "s"})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Start date *
                <input required type="date" value={form.startDate} onChange={(e) => pickStart(e.target.value)} />
              </label>
              <label>
                End date *
                <input required type="date" min={form.startDate} value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
              </label>
              <label>
                Venue
                <input maxLength={200} value={form.venue} onChange={(e) => setForm((f) => ({ ...f, venue: e.target.value }))} placeholder="e.g. Red Dune Training Centre, Jubail" />
              </label>
              <label>
                Instructor
                <input maxLength={120} value={form.instructorName} onChange={(e) => setForm((f) => ({ ...f, instructorName: e.target.value }))} />
              </label>
              <label>
                Seats
                <input type="number" min={1} max={500} value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} />
              </label>
              <label className="trn-span-all">
                Notes
                <textarea rows={2} maxLength={2000} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </label>
            </div>
            <div className="trn-form-actions">
              <button type="button" className="secondary" onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button type="submit" disabled={saving}>
                {saving ? "Creating…" : "Create batch"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
