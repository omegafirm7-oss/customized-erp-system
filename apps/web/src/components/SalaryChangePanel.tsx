import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiClient } from "../api/client";
import { AttachButton } from "./AttachButton";
import { AttachmentViewer } from "./AttachmentViewer";
import { uploadEvidenceFile } from "../utils/uploadEvidence";

interface HistoryRow {
  id: string;
  isOriginal: boolean;
  effectiveFrom: string;
  previousSalary: string | null;
  basicSalary: string;
  changedBy: string | null;
  changedAt: string;
  note: string | null;
  evidence: { filename: string; mimeType: string; size: number } | null;
}

const money = (v: string) => Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Dated basic-salary changes for one employee. Timesheet days before the
 * effective date keep the old salary; days from it onward use the new one.
 * Every change keeps who/when/why and an optional evidence file.
 */
export function SalaryChangePanel({
  employeeId,
  employeeCode,
  currentSalary,
  canEdit,
  onChanged,
}: {
  employeeId: string;
  employeeCode: string;
  currentSalary: string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [basicSalary, setBasicSalary] = useState("");
  const [note, setNote] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ id: string; filename: string; mimeType: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<HistoryRow[]>(`/hr/employees/${employeeId}/salary-history`);
      setRows(res.data);
    } catch {
      /* history is informational; the form still works */
    }
  }, [employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (
      !window.confirm(
        `Change basic salary of ${employeeCode} to ${money(basicSalary)} SAR from ${effectiveFrom}?\n\nDays before ${effectiveFrom} stay at the old salary; days from ${effectiveFrom} onward use the new one.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await apiClient.post<{ results: Array<{ revisionId: string }> }>("/hr/employees/salary-revisions", {
        effectiveFrom,
        basicSalary,
        employeeCodes: [employeeCode],
        note: note.trim() || undefined,
      });
      const revisionId = res.data.results[0]?.revisionId;
      if (evidenceFile && revisionId) {
        try {
          await uploadEvidenceFile(`/hr/salary-revisions/${revisionId}/evidence`, evidenceFile);
        } catch (err: any) {
          setError(err?.response?.data?.message ?? "The salary was changed, but the evidence file did not upload. Attach it from the history below.");
        }
      }
      setMessage(`Salary changed from ${effectiveFrom}.`);
      setBasicSalary("");
      setNote("");
      setEvidenceFile(null);
      await load();
      onChanged();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to change the salary");
    } finally {
      setBusy(false);
    }
  }

  async function attach(revisionId: string, file: File) {
    setUploadingFor(revisionId);
    setError(null);
    try {
      await uploadEvidenceFile(`/hr/salary-revisions/${revisionId}/evidence`, file);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to attach the evidence");
    } finally {
      setUploadingFor(null);
    }
  }

  return (
    <div className="card">
      <h3>Salary changes</h3>
      <p style={{ color: "#667085", fontSize: 13 }}>
        Current basic salary: <strong>{money(currentSalary)} SAR</strong>. A change applies from its effective date onward;
        earlier timesheet days keep the salary they had, so past cost and pending amounts don't move.
      </p>
      {error && <div className="error-banner">{error}</div>}
      {message && <p style={{ color: "#027a48" }}>{message}</p>}

      {canEdit && (
        <form onSubmit={submit}>
          <div className="form-row" style={{ alignItems: "flex-end" }}>
            <div>
              <label>Effective from </label>
              <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required />
            </div>
            <div>
              <label>New basic salary </label>
              <input type="number" min="0" step="0.01" value={basicSalary} onChange={(e) => setBasicSalary(e.target.value)} required style={{ width: 140 }} />
            </div>
            <input placeholder="Reason (raise, promotion, contract renewal…)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} style={{ flex: 1, minWidth: 220 }} />
            <AttachButton uploading={false} onFile={(f) => setEvidenceFile(f)} label={evidenceFile ? "Change file" : "Attach evidence"} />
            {evidenceFile && <span style={{ fontSize: 13 }}>{evidenceFile.name}</span>}
            <button type="submit" disabled={busy || !basicSalary}>
              {busy ? "Saving…" : "Change salary"}
            </button>
          </div>
        </form>
      )}

      {rows.length > 0 && (
        <table style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Effective from</th>
              <th>Previous</th>
              <th>New basic</th>
              <th>Reason</th>
              <th>Changed by</th>
              <th>Recorded on</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((r) => (
              <tr key={r.id}>
                <td>{r.isOriginal ? "Original salary" : r.effectiveFrom}</td>
                <td>{r.previousSalary ? money(r.previousSalary) : "—"}</td>
                <td>{money(r.basicSalary)}</td>
                <td>{r.note ?? "—"}</td>
                <td>{r.isOriginal ? "—" : (r.changedBy ?? "—")}</td>
                <td>{r.isOriginal ? "—" : new Date(r.changedAt).toLocaleString()}</td>
                <td>
                  {r.isOriginal ? (
                    "—"
                  ) : (
                    <>
                      {r.evidence && (
                        <button type="button" className="link-button" onClick={() => setViewer({ id: r.id, filename: r.evidence!.filename, mimeType: r.evidence!.mimeType })}>
                          View
                        </button>
                      )}{" "}
                      {canEdit && <AttachButton uploading={uploadingFor === r.id} onFile={(f) => attach(r.id, f)} label={r.evidence ? "Replace" : "Attach"} />}
                      {!r.evidence && !canEdit && "—"}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {viewer && (
        <AttachmentViewer
          filename={viewer.filename}
          mimeType={viewer.mimeType}
          fetchBlob={() => apiClient.get(`/hr/salary-revisions/${viewer.id}/evidence`, { responseType: "blob" }).then((res) => res.data as Blob)}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}
