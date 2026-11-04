import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useCanDownload } from "../../hooks/useCanDownload";
import { certificateVerifyUrl, downloadCertificatePdf } from "../../utils/certificatePdf";
import { TraineeFormModal } from "./TraineeForm";
import {
  BATCH_STATUSES,
  BatchStatus,
  BatchStatusBadge,
  Course,
  Modal,
  Result,
  ResultBadge,
  Trainee,
  employerLabel,
  errMsg,
  fmtDate,
  useTrainingPermissions,
} from "./trainingShared";

interface Enrollment {
  id: string;
  theoryMarks: string | null;
  practicalMarks: string | null;
  result: Result;
  resultOverride: boolean;
  remarks: string | null;
  trainee: {
    id: string;
    fullName: string;
    idType: string;
    idNumber: string;
    phone: string | null;
    nationality: string | null;
    employerName: string | null;
    employerPartner: { id: string; name: string } | null;
  };
  attendance: Array<{ date: string; present: boolean }>;
  certificate: { id: string; certificateNo: string; issueDate: string; expiryDate: string; status: "VALID" | "REVOKED"; externalCardNo: string | null; verifyToken: string } | null;
}

interface Batch {
  id: string;
  batchNo: string;
  startDate: string;
  endDate: string;
  venue: string | null;
  instructorName: string | null;
  capacity: number | null;
  status: BatchStatus;
  notes: string | null;
  course: Course;
  days: string[];
  enrollments: Enrollment[];
}

type MarkRow = { theory: string; practical: string; override: "" | Result; remarks: string };

function dayLabel(iso: string): { dow: string; dm: string } {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return {
    dow: dt.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" }),
    dm: dt.toLocaleDateString(undefined, { day: "2-digit", month: "short", timeZone: "UTC" }),
  };
}

export function TrainingBatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canManage } = useTrainingPermissions();
  const canDownload = useCanDownload();
  const [batch, setBatch] = useState<Batch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<"trainees" | "attendance">("trainees");
  const [busy, setBusy] = useState(false);

  // attendance draft: key `${enrollmentId}|${date}`
  const [att, setAtt] = useState<Record<string, boolean>>({});
  const [attDirty, setAttDirty] = useState(false);
  const [marks, setMarks] = useState<Record<string, MarkRow>>({});
  const [marksDirty, setMarksDirty] = useState(false);

  const [editing, setEditing] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [issueDate, setIssueDate] = useState("");

  const applyBatch = useCallback((b: Batch) => {
    setBatch(b);
    const a: Record<string, boolean> = {};
    const m: Record<string, MarkRow> = {};
    for (const e of b.enrollments) {
      for (const r of e.attendance) a[`${e.id}|${r.date}`] = r.present;
      m[e.id] = {
        theory: e.theoryMarks != null ? String(Number(e.theoryMarks)) : "",
        practical: e.practicalMarks != null ? String(Number(e.practicalMarks)) : "",
        override: e.resultOverride ? e.result : "",
        remarks: e.remarks ?? "",
      };
    }
    setAtt(a);
    setMarks(m);
    setAttDirty(false);
    setMarksDirty(false);
    setIssueDate(b.endDate.slice(0, 10));
  }, []);

  const load = useCallback(() => {
    return apiClient
      .get<Batch>(`/training/batches/${id}`)
      .then((r) => applyBatch(r.data))
      .catch((e) => setError(errMsg(e, "Failed to load batch")));
  }, [id, applyBatch]);

  useEffect(() => {
    load();
  }, [load]);

  const passedWaiting = useMemo(() => batch?.enrollments.filter((e) => e.result === "PASSED" && !e.certificate).length ?? 0, [batch]);

  if (!batch) return <div className="card">{error ? <div className="error-banner">{error}</div> : <p>Loading…</p>}</div>;

  const closed = batch.status === "CANCELLED";
  const hasPractical = batch.course.practicalMaxMarks > 0;

  function toggleAtt(enrollmentId: string, date: string) {
    if (!canManage || closed) return;
    const key = `${enrollmentId}|${date}`;
    setAtt((a) => ({ ...a, [key]: a[key] === undefined ? true : !a[key] }));
    setAttDirty(true);
  }

  function markDayAll(date: string, present: boolean) {
    if (!batch) return;
    setAtt((a) => {
      const next = { ...a };
      for (const e of batch.enrollments) next[`${e.id}|${date}`] = present;
      return next;
    });
    setAttDirty(true);
  }

  async function saveAttendance() {
    if (!batch) return;
    setBusy(true);
    setError(null);
    try {
      const entries = Object.entries(att).map(([key, present]) => {
        const [enrollmentId, date] = key.split("|");
        return { enrollmentId, date, present };
      });
      const r = await apiClient.put<Batch>(`/training/batches/${batch.id}/attendance`, { entries });
      applyBatch(r.data);
      setNotice("Attendance saved.");
    } catch (e) {
      setError(errMsg(e, "Failed to save attendance"));
    } finally {
      setBusy(false);
    }
  }

  function setMark(enrollmentId: string, patch: Partial<MarkRow>) {
    setMarks((m) => ({ ...m, [enrollmentId]: { ...m[enrollmentId], ...patch } }));
    setMarksDirty(true);
  }

  async function saveMarks() {
    if (!batch) return;
    setBusy(true);
    setError(null);
    try {
      const entries = batch.enrollments
        .filter((e) => !e.certificate)
        .map((e) => {
          const m = marks[e.id];
          return {
            enrollmentId: e.id,
            theoryMarks: m.theory === "" ? null : Number(m.theory),
            practicalMarks: hasPractical ? (m.practical === "" ? null : Number(m.practical)) : null,
            resultOverride: m.override === "" ? null : m.override,
            remarks: m.remarks,
          };
        });
      const r = await apiClient.put<Batch>(`/training/batches/${batch.id}/marks`, { entries });
      applyBatch(r.data);
      setNotice("Marks saved. Results updated.");
    } catch (e) {
      setError(errMsg(e, "Failed to save marks"));
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: BatchStatus) {
    if (!batch) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.patch(`/training/batches/${batch.id}`, { status });
      await load();
    } catch (e) {
      setError(errMsg(e, "Failed to update status"));
    } finally {
      setBusy(false);
    }
  }

  async function removeEnrollment(e: Enrollment) {
    if (!confirm(`Remove ${e.trainee.fullName} from this batch?`)) return;
    try {
      await apiClient.delete(`/training/enrollments/${e.id}`);
      await load();
    } catch (err) {
      setError(errMsg(err, "Failed to remove trainee"));
    }
  }

  async function issue(ev: FormEvent) {
    ev.preventDefault();
    if (!batch) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiClient.post<{ issued: number }>(`/training/batches/${batch.id}/certificates`, { issueDate });
      setIssuing(false);
      setNotice(`${r.data.issued} certificate(s) issued.`);
      await load();
    } catch (e) {
      setError(errMsg(e, "Failed to issue certificates"));
    } finally {
      setBusy(false);
    }
  }

  async function deleteBatch() {
    if (!batch || !confirm(`Delete batch ${batch.batchNo}? Enrolments, attendance and marks are removed too.`)) return;
    try {
      await apiClient.delete(`/training/batches/${batch.id}`);
      navigate("/training/batches");
    } catch (e) {
      setError(errMsg(e, "Failed to delete batch"));
    }
  }

  async function copyVerify(token: string) {
    await navigator.clipboard.writeText(certificateVerifyUrl(token));
    setNotice("Verification link copied.");
  }

  async function pdf(certId: string) {
    try {
      await downloadCertificatePdf(certId);
    } catch (e) {
      setError(errMsg(e, "Failed to create certificate PDF"));
    }
  }

  const anyCert = batch.enrollments.some((e) => e.certificate);

  return (
    <div>
      <div className="card">
        <p>
          <Link to="/training/batches">← Batches</Link>
        </p>
        <div className="trn-header">
          <div>
            <h2>
              {batch.batchNo} · {batch.course.name}
            </h2>
            <BatchStatusBadge status={batch.status} />
          </div>
          {canManage && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select value={batch.status} disabled={busy} onChange={(e) => setStatus(e.target.value as BatchStatus)} aria-label="Batch status">
                {BATCH_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace("_", " ").toLowerCase()}
                  </option>
                ))}
              </select>
              <button className="secondary" onClick={() => setEditing(true)}>
                Edit details
              </button>
              {!anyCert && (
                <button className="secondary" onClick={deleteBatch}>
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
        <div className="trn-facts">
          <div>
            <span>Dates</span>
            {fmtDate(batch.startDate)} – {fmtDate(batch.endDate)} ({batch.days.length} day{batch.days.length === 1 ? "" : "s"})
          </div>
          <div>
            <span>Venue</span>
            {batch.venue ?? "—"}
          </div>
          <div>
            <span>Instructor</span>
            {batch.instructorName ?? "—"}
          </div>
          <div>
            <span>Seats</span>
            {batch.enrollments.length}
            {batch.capacity ? ` / ${batch.capacity}` : ""}
          </div>
          <div>
            <span>Pass rule</span>
            {batch.course.passMarkPercent}% · attendance ≥ {batch.course.minAttendancePercent}%
          </div>
          <div>
            <span>Certificate validity</span>
            {batch.course.validityMonths} months
          </div>
        </div>
        {batch.notes && <p className="trn-muted">{batch.notes}</p>}
      </div>

      <div className="card">
        {error && <div className="error-banner">{error}</div>}
        {notice && (
          <div className="trn-muted" style={{ background: "#ecfdf3", color: "#05603a", padding: "8px 12px", borderRadius: 6, marginBottom: 12 }} onClick={() => setNotice(null)}>
            {notice}
          </div>
        )}
        <div className="tab-row">
          <button className={tab === "trainees" ? "" : "secondary"} onClick={() => setTab("trainees")}>
            Trainees &amp; results ({batch.enrollments.length})
          </button>
          <button className={tab === "attendance" ? "" : "secondary"} onClick={() => setTab("attendance")}>
            Attendance
          </button>
          <span style={{ flex: 1 }} />
          {canManage && !closed && batch.status !== "COMPLETED" && (
            <button className="secondary" onClick={() => setEnrolling(true)}>
              + Enrol trainees
            </button>
          )}
          {canManage && passedWaiting > 0 && !closed && <button onClick={() => setIssuing(true)}>Issue certificates ({passedWaiting})</button>}
        </div>

        {batch.enrollments.length === 0 ? (
          <p className="trn-muted">No trainees enrolled yet.</p>
        ) : tab === "trainees" ? (
          <>
            <div className="trn-table-wrap">
              <table className="trn-marks">
                <thead>
                  <tr>
                    <th>Trainee</th>
                    <th>Employer</th>
                    <th>Theory / {batch.course.theoryMaxMarks}</th>
                    {hasPractical && <th>Practical / {batch.course.practicalMaxMarks}</th>}
                    <th>Result</th>
                    <th>Override</th>
                    <th>Remarks</th>
                    <th>Certificate</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {batch.enrollments.map((e) => {
                    const m = marks[e.id];
                    const locked = !canManage || !!e.certificate || closed;
                    return (
                      <tr key={e.id}>
                        <td>
                          <Link to={`/training/trainees/${e.trainee.id}`}>{e.trainee.fullName}</Link>
                          <div className="trn-muted">{e.trainee.idNumber}</div>
                        </td>
                        <td>{employerLabel(e.trainee)}</td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            max={batch.course.theoryMaxMarks}
                            step="0.5"
                            disabled={locked}
                            value={m?.theory ?? ""}
                            onChange={(ev) => setMark(e.id, { theory: ev.target.value })}
                            aria-label={`Theory marks for ${e.trainee.fullName}`}
                          />
                        </td>
                        {hasPractical && (
                          <td>
                            <input
                              type="number"
                              min={0}
                              max={batch.course.practicalMaxMarks}
                              step="0.5"
                              disabled={locked}
                              value={m?.practical ?? ""}
                              onChange={(ev) => setMark(e.id, { practical: ev.target.value })}
                              aria-label={`Practical marks for ${e.trainee.fullName}`}
                            />
                          </td>
                        )}
                        <td>
                          <ResultBadge result={e.result} />
                        </td>
                        <td>
                          <select disabled={locked} value={m?.override ?? ""} onChange={(ev) => setMark(e.id, { override: ev.target.value as MarkRow["override"] })}>
                            <option value="">Auto</option>
                            <option value="PASSED">Passed</option>
                            <option value="FAILED">Failed</option>
                            <option value="ABSENT">Absent</option>
                          </select>
                        </td>
                        <td>
                          <input style={{ width: 150 }} maxLength={500} disabled={locked} value={m?.remarks ?? ""} onChange={(ev) => setMark(e.id, { remarks: ev.target.value })} />
                        </td>
                        <td>
                          {e.certificate ? (
                            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                              <span className={`badge ${e.certificate.status === "REVOKED" ? "reversed" : "posted"}`}>{e.certificate.certificateNo}</span>
                              {canDownload && (
                                <button className="secondary" onClick={() => pdf(e.certificate!.id)}>
                                  PDF
                                </button>
                              )}
                              <button className="secondary" onClick={() => copyVerify(e.certificate!.verifyToken)} title="Copy the public verification link">
                                Link
                              </button>
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          {canManage && !e.certificate && (
                            <button className="secondary" onClick={() => removeEnrollment(e)} title="Remove from batch">
                              ✕
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {canManage && !closed && (
              <div className="trn-form-actions">
                <button onClick={saveMarks} disabled={busy || !marksDirty}>
                  {busy ? "Saving…" : "Save marks"}
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="trn-muted">Click a cell to mark Present (P) / Absent (A). Days left blank don't count against attendance until marked.</p>
            <div className="trn-table-wrap">
              <table className="trn-att">
                <thead>
                  <tr>
                    <th>Trainee</th>
                    {batch.days.map((d) => {
                      const l = dayLabel(d);
                      return (
                        <th key={d} className="trn-day">
                          <div>{l.dow}</div>
                          <div style={{ fontWeight: 400 }}>{l.dm}</div>
                          {canManage && !closed && (
                            <button className="secondary" style={{ padding: "1px 6px", fontSize: 11, marginTop: 2 }} onClick={() => markDayAll(d, true)} title="Mark everyone present">
                              All P
                            </button>
                          )}
                        </th>
                      );
                    })}
                    <th>Present</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.enrollments.map((e) => {
                    const present = batch.days.filter((d) => att[`${e.id}|${d}`] === true).length;
                    return (
                      <tr key={e.id}>
                        <td>{e.trainee.fullName}</td>
                        {batch.days.map((d) => {
                          const v = att[`${e.id}|${d}`];
                          return (
                            <td key={d} className="trn-day">
                              <button
                                className={v === undefined ? "trn-u" : v ? "trn-p" : "trn-a"}
                                onClick={() => toggleAtt(e.id, d)}
                                disabled={!canManage || closed}
                                aria-label={`${e.trainee.fullName} ${d}`}
                              >
                                {v === undefined ? "·" : v ? "P" : "A"}
                              </button>
                            </td>
                          );
                        })}
                        <td>
                          {present} / {batch.days.length}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {canManage && !closed && (
              <div className="trn-form-actions">
                <button onClick={saveAttendance} disabled={busy || !attDirty}>
                  {busy ? "Saving…" : "Save attendance"}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {editing && <EditBatchModal batch={batch} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />}
      {enrolling && (
        <EnrollModal
          batch={batch}
          onClose={() => setEnrolling(false)}
          onDone={(n) => {
            setEnrolling(false);
            setNotice(`${n} trainee(s) enrolled.`);
            load();
          }}
        />
      )}
      {issuing && (
        <Modal title="Issue certificates" onClose={() => setIssuing(false)}>
          <form onSubmit={issue}>
            <p>
              Issue certificates to the <b>{passedWaiting}</b> passed trainee(s) who don't have one yet. Each gets the next certificate number and expires{" "}
              {batch.course.validityMonths} months after the issue date.
            </p>
            <div className="trn-form-grid">
              <label>
                Issue date
                <input type="date" required value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
              </label>
            </div>
            <p className="trn-muted">Marks of certified trainees are locked. A wrong certificate can be revoked from the Certificates page.</p>
            <div className="trn-form-actions">
              <button type="button" className="secondary" onClick={() => setIssuing(false)}>
                Cancel
              </button>
              <button type="submit" disabled={busy}>
                {busy ? "Issuing…" : "Issue"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function EditBatchModal({ batch, onClose, onSaved }: { batch: Batch; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    startDate: batch.startDate.slice(0, 10),
    endDate: batch.endDate.slice(0, 10),
    venue: batch.venue ?? "",
    instructorName: batch.instructorName ?? "",
    capacity: batch.capacity != null ? String(batch.capacity) : "",
    notes: batch.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiClient.patch(`/training/batches/${batch.id}`, {
        startDate: form.startDate,
        endDate: form.endDate,
        venue: form.venue.trim() || undefined,
        instructorName: form.instructorName.trim() || undefined,
        capacity: form.capacity ? Number(form.capacity) : undefined,
        notes: form.notes.trim() || undefined,
      });
      onSaved();
    } catch (err) {
      setError(errMsg(err, "Failed to save batch"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Edit ${batch.batchNo}`} onClose={onClose}>
      <form onSubmit={save}>
        {error && <div className="error-banner">{error}</div>}
        <div className="trn-form-grid">
          <label>
            Start date
            <input type="date" required value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
          </label>
          <label>
            End date
            <input type="date" required min={form.startDate} value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
          </label>
          <label>
            Venue
            <input maxLength={200} value={form.venue} onChange={(e) => setForm((f) => ({ ...f, venue: e.target.value }))} />
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
        <p className="trn-muted">Shortening the dates removes attendance recorded on days outside the new range.</p>
        <div className="trn-form-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EnrollModal({ batch, onClose, onDone }: { batch: Batch; onClose: () => void; onDone: (n: number) => void }) {
  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const enrolled = useMemo(() => new Set(batch.enrollments.map((e) => e.trainee.id)), [batch]);

  const load = useCallback((term: string) => {
    return apiClient
      .get<Trainee[]>("/training/trainees", { params: { q: term || undefined } })
      .then((r) => setTrainees(r.data.filter((t) => t.isActive)))
      .catch((e) => setError(errMsg(e, "Failed to load trainees")));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(q), 250);
    return () => clearTimeout(t);
  }, [q, load]);

  const seatsLeft = batch.capacity != null ? batch.capacity - batch.enrollments.length : null;

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function enroll(ids: string[]) {
    setSaving(true);
    setError(null);
    try {
      const r = await apiClient.post<{ enrolled: number }>(`/training/batches/${batch.id}/enrollments`, { traineeIds: ids });
      onDone(r.data.enrolled);
    } catch (e) {
      setError(errMsg(e, "Failed to enrol trainees"));
    } finally {
      setSaving(false);
    }
  }

  const available = trainees.filter((t) => !enrolled.has(t.id));

  return (
    <>
      <Modal title={`Enrol trainees in ${batch.batchNo}`} onClose={onClose}>
        {error && <div className="error-banner">{error}</div>}
        <div className="trn-toolbar">
          <input className="trn-grow" placeholder="Search name, ID, employer…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <button className="secondary" onClick={() => setCreating(true)}>
            + New trainee
          </button>
        </div>
        {seatsLeft != null && <p className="trn-muted">{seatsLeft} seat(s) left.</p>}
        <div className="trn-pick-list">
          {available.length === 0 ? (
            <p className="trn-muted" style={{ padding: 12 }}>
              No trainees to add. Create one with “New trainee”.
            </p>
          ) : (
            available.map((t) => (
              <label key={t.id}>
                <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
                <span style={{ flex: 1 }}>
                  <b>{t.fullName}</b> <span className="trn-muted">· {t.idNumber}</span>
                </span>
                <span className="trn-muted">{employerLabel(t)}</span>
              </label>
            ))
          )}
        </div>
        <div className="trn-form-actions">
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button disabled={saving || selected.size === 0} onClick={() => enroll([...selected])}>
            {saving ? "Enrolling…" : `Enrol ${selected.size || ""}`}
          </button>
        </div>
      </Modal>
      {creating && (
        <TraineeFormModal
          trainee={null}
          onClose={() => setCreating(false)}
          onSaved={(t) => {
            setCreating(false);
            enroll([t.id]);
          }}
        />
      )}
    </>
  );
}
