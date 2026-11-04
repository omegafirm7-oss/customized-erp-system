import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiClient } from "../../api/client";
import { Course, Modal, errMsg, useTrainingPermissions } from "./trainingShared";

type Form = {
  code: string;
  name: string;
  category: string;
  description: string;
  durationDays: string;
  durationHours: string;
  pricePerTrainee: string;
  validityMonths: string;
  passMarkPercent: string;
  theoryMaxMarks: string;
  practicalMaxMarks: string;
  minAttendancePercent: string;
  isActive: boolean;
};

const EMPTY: Form = {
  code: "",
  name: "",
  category: "TUV Card",
  description: "",
  durationDays: "1",
  durationHours: "",
  pricePerTrainee: "",
  validityMonths: "24",
  passMarkPercent: "70",
  theoryMaxMarks: "100",
  practicalMaxMarks: "100",
  minAttendancePercent: "100",
  isActive: true,
};

function toForm(c: Course): Form {
  return {
    code: c.code,
    name: c.name,
    category: c.category ?? "",
    description: c.description ?? "",
    durationDays: String(c.durationDays),
    durationHours: c.durationHours != null ? String(c.durationHours) : "",
    pricePerTrainee: c.pricePerTrainee ?? "",
    validityMonths: String(c.validityMonths),
    passMarkPercent: String(c.passMarkPercent),
    theoryMaxMarks: String(c.theoryMaxMarks),
    practicalMaxMarks: String(c.practicalMaxMarks),
    minAttendancePercent: String(c.minAttendancePercent),
    isActive: c.isActive,
  };
}

function validityLabel(months: number): string {
  return months % 12 === 0 ? `${months / 12} yr${months === 12 ? "" : "s"}` : `${months} mo`;
}

export function TrainingCoursesPage() {
  const { canManage } = useTrainingPermissions();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Course | "new" | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    return apiClient
      .get<Course[]>("/training/courses", { params: { includeInactive: showInactive ? "true" : undefined } })
      .then((r) => setCourses(r.data))
      .catch((e) => setError(errMsg(e, "Failed to load courses")))
      .finally(() => setLoading(false));
  }, [showInactive]);

  useEffect(() => {
    load();
  }, [load]);

  function open(c: Course | "new") {
    setEditing(c);
    setForm(c === "new" ? EMPTY : toForm(c));
    setFormError(null);
  }

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const body = {
      code: form.code.trim(),
      name: form.name.trim(),
      category: form.category.trim() || undefined,
      description: form.description.trim() || undefined,
      durationDays: Number(form.durationDays),
      durationHours: form.durationHours ? Number(form.durationHours) : undefined,
      pricePerTrainee: form.pricePerTrainee ? Number(form.pricePerTrainee) : undefined,
      validityMonths: Number(form.validityMonths),
      passMarkPercent: Number(form.passMarkPercent),
      theoryMaxMarks: Number(form.theoryMaxMarks),
      practicalMaxMarks: Number(form.practicalMaxMarks),
      minAttendancePercent: Number(form.minAttendancePercent),
      isActive: form.isActive,
    };
    try {
      if (editing === "new") await apiClient.post("/training/courses", body);
      else if (editing) await apiClient.patch(`/training/courses/${editing.id}`, body);
      setEditing(null);
      await load();
    } catch (err) {
      setFormError(errMsg(err, "Failed to save course"));
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: Course) {
    if (!confirm(`Delete course "${c.name}"?`)) return;
    try {
      await apiClient.delete(`/training/courses/${c.id}`);
      setEditing(null);
      await load();
    } catch (err) {
      setFormError(errMsg(err, "Failed to delete course"));
    }
  }

  return (
    <div className="card">
      <div className="trn-header">
        <div>
          <h2>Courses</h2>
          <p className="trn-muted">One course per card/certificate Red Dune offers. Validity sets the expiry of issued certificates.</p>
        </div>
        {canManage && <button onClick={() => open("new")}>+ New course</button>}
      </div>
      {error && <div className="error-banner">{error}</div>}
      <div className="trn-toolbar">
        <label className="trn-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
        </label>
      </div>
      {loading ? (
        <p>Loading…</p>
      ) : courses.length === 0 ? (
        <p className="trn-muted">No courses yet. Add the cards you offer with “New course”.</p>
      ) : (
        <div className="trn-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Course</th>
                <th>Category</th>
                <th>Duration</th>
                <th style={{ textAlign: "right" }}>Price / trainee</th>
                <th>Validity</th>
                <th>Pass mark</th>
                <th>Batches</th>
                <th>Certificates</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {courses.map((c) => (
                <tr key={c.id} style={c.isActive ? undefined : { opacity: 0.55 }}>
                  <td>{c.code}</td>
                  <td>
                    {c.name}
                    {!c.isActive && <span className="badge reversed" style={{ marginLeft: 6 }}>Inactive</span>}
                  </td>
                  <td>{c.category ?? "—"}</td>
                  <td>
                    {c.durationDays} day{c.durationDays === 1 ? "" : "s"}
                    {c.durationHours ? ` · ${c.durationHours} h` : ""}
                  </td>
                  <td style={{ textAlign: "right" }}>{c.pricePerTrainee != null ? Number(c.pricePerTrainee).toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}</td>
                  <td>{validityLabel(c.validityMonths)}</td>
                  <td>{c.passMarkPercent}%</td>
                  <td>{c._count?.batches ?? 0}</td>
                  <td>{c._count?.certificates ?? 0}</td>
                  <td>
                    {canManage && (
                      <button className="secondary" onClick={() => open(c)}>
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal title={editing === "new" ? "New course" : `Edit ${editing.code}`} onClose={() => setEditing(null)} wide>
          <form onSubmit={save}>
            {formError && <div className="error-banner">{formError}</div>}
            <div className="trn-form-grid">
              <label>
                Code *
                <input required maxLength={30} value={form.code} onChange={set("code")} placeholder="e.g. RIG-2" />
              </label>
              <label style={{ gridColumn: "span 2" }}>
                Course / card name *
                <input required maxLength={200} value={form.name} onChange={set("name")} placeholder="e.g. Rigger Level II" />
              </label>
              <label>
                Category
                <input maxLength={100} value={form.category} onChange={set("category")} />
              </label>
              <label>
                Duration (days) *
                <input required type="number" min={1} max={60} value={form.durationDays} onChange={set("durationDays")} />
              </label>
              <label>
                Duration (hours)
                <input type="number" min={1} max={1000} value={form.durationHours} onChange={set("durationHours")} />
              </label>
              <label>
                Price per trainee
                <input type="number" min={0} step="0.01" value={form.pricePerTrainee} onChange={set("pricePerTrainee")} />
              </label>
              <label>
                Certificate validity (months) *
                <input required type="number" min={1} max={240} value={form.validityMonths} onChange={set("validityMonths")} />
              </label>
              <label>
                Pass mark (%) *
                <input required type="number" min={1} max={100} value={form.passMarkPercent} onChange={set("passMarkPercent")} />
              </label>
              <label>
                Theory max marks *
                <input required type="number" min={0} max={1000} value={form.theoryMaxMarks} onChange={set("theoryMaxMarks")} />
              </label>
              <label>
                Practical max marks (0 = none) *
                <input required type="number" min={0} max={1000} value={form.practicalMaxMarks} onChange={set("practicalMaxMarks")} />
              </label>
              <label>
                Minimum attendance (%) *
                <input required type="number" min={0} max={100} value={form.minAttendancePercent} onChange={set("minAttendancePercent")} />
              </label>
              <label className="trn-span-all">
                Description
                <textarea rows={3} maxLength={2000} value={form.description} onChange={set("description")} />
              </label>
              <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} /> Active
              </label>
            </div>
            <p className="trn-muted" style={{ marginTop: 10 }}>
              A trainee passes when theory (and practical, if any) reach the pass mark and attendance reaches the minimum.
            </p>
            <div className="trn-form-actions">
              {editing !== "new" && (editing._count?.batches ?? 0) === 0 && (
                <button type="button" className="secondary" style={{ marginRight: "auto" }} onClick={() => remove(editing)}>
                  Delete
                </button>
              )}
              <button type="button" className="secondary" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
