import { FormEvent, useEffect, useState } from "react";
import { apiClient } from "../../api/client";
import { Employer, ID_TYPES, Modal, Trainee, errMsg } from "./trainingShared";

type Form = {
  fullName: string;
  fullNameAr: string;
  idType: string;
  idNumber: string;
  nationality: string;
  phone: string;
  email: string;
  dateOfBirth: string;
  jobTitle: string;
  employerPartnerId: string;
  employerName: string;
  notes: string;
  isActive: boolean;
};

function toForm(t?: Trainee | null): Form {
  return {
    fullName: t?.fullName ?? "",
    fullNameAr: t?.fullNameAr ?? "",
    idType: t?.idType ?? "IQAMA",
    idNumber: t?.idNumber ?? "",
    nationality: t?.nationality ?? "",
    phone: t?.phone ?? "",
    email: t?.email ?? "",
    dateOfBirth: t?.dateOfBirth ? t.dateOfBirth.slice(0, 10) : "",
    jobTitle: t?.jobTitle ?? "",
    employerPartnerId: t?.employerPartnerId ?? "",
    employerName: t?.employerName ?? "",
    notes: t?.notes ?? "",
    isActive: t?.isActive ?? true,
  };
}

/** Downscales a photo to ≤600px JPEG so uploads stay small. */
export async function compressPhoto(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, 600 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", 0.85));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function TraineeFormModal({ trainee, onClose, onSaved }: { trainee: Trainee | null; onClose: () => void; onSaved: (t: Trainee) => void }) {
  const [form, setForm] = useState<Form>(toForm(trainee));
  const [employers, setEmployers] = useState<Employer[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);

  useEffect(() => {
    apiClient.get<Employer[]>("/training/employers").then((r) => setEmployers(r.data)).catch(() => setEmployers([]));
  }, []);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      fullName: form.fullName.trim(),
      fullNameAr: form.fullNameAr.trim() || undefined,
      idType: form.idType,
      idNumber: form.idNumber.trim(),
      nationality: form.nationality.trim() || undefined,
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      dateOfBirth: form.dateOfBirth || undefined,
      jobTitle: form.jobTitle.trim() || undefined,
      employerPartnerId: form.employerPartnerId || undefined,
      employerName: form.employerPartnerId ? undefined : form.employerName.trim() || undefined,
      notes: form.notes.trim() || undefined,
      isActive: form.isActive,
    };
    try {
      const res = trainee ? await apiClient.patch<Trainee>(`/training/trainees/${trainee.id}`, body) : await apiClient.post<Trainee>("/training/trainees", body);
      if (photo) {
        const fd = new FormData();
        fd.append("file", await compressPhoto(photo), "photo.jpg");
        await apiClient.post(`/training/trainees/${res.data.id}/photo`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      }
      onSaved(res.data);
    } catch (err) {
      setError(errMsg(err, "Failed to save trainee"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={trainee ? `Edit ${trainee.fullName}` : "New trainee"} onClose={onClose} wide>
      <form onSubmit={save}>
        {error && <div className="error-banner">{error}</div>}
        <div className="trn-form-grid">
          <label style={{ gridColumn: "span 2" }}>
            Full name (as on ID) *
            <input required maxLength={200} value={form.fullName} onChange={set("fullName")} />
          </label>
          <label>
            Name in Arabic
            <input dir="rtl" maxLength={200} value={form.fullNameAr} onChange={set("fullNameAr")} />
          </label>
          <label>
            ID type
            <select value={form.idType} onChange={set("idType")}>
              {ID_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            ID number *
            <input required minLength={3} maxLength={40} value={form.idNumber} onChange={set("idNumber")} />
          </label>
          <label>
            Nationality
            <input maxLength={80} value={form.nationality} onChange={set("nationality")} />
          </label>
          <label>
            Mobile (WhatsApp)
            <input maxLength={40} value={form.phone} onChange={set("phone")} placeholder="05xxxxxxxx" />
          </label>
          <label>
            Email
            <input type="email" value={form.email} onChange={set("email")} />
          </label>
          <label>
            Date of birth
            <input type="date" value={form.dateOfBirth} onChange={set("dateOfBirth")} />
          </label>
          <label>
            Job title / trade
            <input maxLength={120} value={form.jobTitle} onChange={set("jobTitle")} />
          </label>
          <label>
            Employer (customer)
            <select value={form.employerPartnerId} onChange={set("employerPartnerId")}>
              <option value="">— Not in Partners / individual —</option>
              {employers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.code})
                </option>
              ))}
            </select>
          </label>
          {!form.employerPartnerId && (
            <label>
              Employer name
              <input maxLength={200} value={form.employerName} onChange={set("employerName")} placeholder="If not a customer in Partners" />
            </label>
          )}
          <label>
            Photo (for certificate)
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          </label>
          <label className="trn-span-all">
            Notes
            <textarea rows={2} maxLength={2000} value={form.notes} onChange={set("notes")} />
          </label>
          {trainee && (
            <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} /> Active
            </label>
          )}
        </div>
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
