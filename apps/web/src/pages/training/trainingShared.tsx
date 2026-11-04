import { useAuth } from "../../auth/AuthContext";
import "./training.css";

export interface Course {
  id: string;
  code: string;
  name: string;
  category: string | null;
  description: string | null;
  durationDays: number;
  durationHours: number | null;
  pricePerTrainee: string | null;
  validityMonths: number;
  passMarkPercent: number;
  theoryMaxMarks: number;
  practicalMaxMarks: number;
  minAttendancePercent: number;
  isActive: boolean;
  _count?: { batches: number; certificates: number };
}

export interface Employer {
  id: string;
  code: string;
  name: string;
}

export interface Trainee {
  id: string;
  fullName: string;
  fullNameAr: string | null;
  idType: string;
  idNumber: string;
  nationality: string | null;
  phone: string | null;
  email: string | null;
  dateOfBirth: string | null;
  jobTitle: string | null;
  employerPartnerId: string | null;
  employerName: string | null;
  photoMimeType: string | null;
  notes: string | null;
  isActive: boolean;
  employerPartner: { id: string; code: string; name: string } | null;
  _count?: { enrollments: number; certificates: number };
}

export type BatchStatus = "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type Result = "PENDING" | "PASSED" | "FAILED" | "ABSENT";
export type CertStatus = "VALID" | "EXPIRED" | "REVOKED";

export const BATCH_STATUSES: BatchStatus[] = ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
export const ID_TYPES = [
  { value: "IQAMA", label: "Iqama" },
  { value: "NATIONAL_ID", label: "National ID" },
  { value: "PASSPORT", label: "Passport" },
  { value: "OTHER", label: "Other" },
];

export function useTrainingPermissions() {
  const { user } = useAuth();
  const perms = user?.permissions ?? [];
  return {
    canManage: !!user?.isPlatformAdmin || perms.includes("training.manage"),
    canView: !!user?.isPlatformAdmin || perms.includes("training.view") || perms.includes("training.manage"),
  };
}

export function errMsg(err: unknown, fallback: string): string {
  const m = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (Array.isArray(m)) return m.join("; ");
  return typeof m === "string" ? m : fallback;
}

/** Formats a date-only ISO string ("2026-11-04" or "2026-11-04T00:00:00.000Z") without timezone shifting. */
export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function employerLabel(t: { employerPartner?: { name: string } | null; employerName?: string | null }): string {
  return t.employerPartner?.name ?? t.employerName ?? "—";
}

const BATCH_LABEL: Record<BatchStatus, string> = { SCHEDULED: "Scheduled", IN_PROGRESS: "In progress", COMPLETED: "Completed", CANCELLED: "Cancelled" };

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  const cls = status === "COMPLETED" ? "posted" : status === "CANCELLED" ? "reversed" : status === "IN_PROGRESS" ? "trn-blue" : "draft";
  return <span className={`badge ${cls}`}>{BATCH_LABEL[status]}</span>;
}

export function ResultBadge({ result }: { result: Result }) {
  const cls = result === "PASSED" ? "posted" : result === "FAILED" || result === "ABSENT" ? "reversed" : "draft";
  return <span className={`badge ${cls}`}>{result.charAt(0) + result.slice(1).toLowerCase()}</span>;
}

export function CertStatusBadge({ status, daysToExpiry }: { status: CertStatus; daysToExpiry?: number }) {
  if (status === "VALID" && daysToExpiry != null && daysToExpiry <= 30) {
    return <span className="badge warning">Expires in {daysToExpiry}d</span>;
  }
  const cls = status === "VALID" ? "posted" : "reversed";
  return <span className={`badge ${cls}`}>{status.charAt(0) + status.slice(1).toLowerCase()}</span>;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="trn-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`trn-modal ${wide ? "trn-modal-wide" : ""}`} role="dialog" aria-label={title}>
        <div className="trn-modal-head">
          <h3>{title}</h3>
          <button className="secondary" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
