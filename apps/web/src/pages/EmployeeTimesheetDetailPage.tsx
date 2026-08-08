import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiClient } from "../api/client";
import { AttachButton } from "../components/AttachButton";
import { AttachmentViewer } from "../components/AttachmentViewer";
import { useAuth } from "../auth/AuthContext";
import { useCompanies } from "../hooks/useCompanies";
import { downloadEmployeeAttendancePdf } from "../utils/attendancePdf";

interface FiscalPeriod {
  id: string;
  periodNumber: number;
  startDate: string;
  endDate: string;
}

interface TimesheetDetailEntry {
  id: string;
  date: string;
  dayType: string;
  hoursWorked: string;
  cost: string;
  attachmentFilename: string | null;
}

interface TimesheetDetailResponse {
  scope: "overall" | "period";
  fiscalPeriodId: string | null;
  employeeId: string;
  code: string;
  nameEn: string;
  hourlyRate: string;
  entries: TimesheetDetailEntry[];
  totalHours: string;
  totalCost: string;
}

const DAY_TYPE_LABELS: Record<string, string> = {
  WORKED: "Worked",
  REST: "Rest",
  ABSENT: "Absent",
  UNPAID_LEAVE: "Unpaid leave",
  ANNUAL_LEAVE: "Annual leave",
};

function money(v: string | number): string {
  return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function EmployeeTimesheetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { companies } = useCompanies();
  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [periodId, setPeriodId] = useState("");
  const [scope, setScope] = useState<"overall" | "period">("overall");
  const [detail, setDetail] = useState<TimesheetDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ entryId: string; filename: string } | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  useEffect(() => {
    apiClient.get<FiscalPeriod[]>("/companies/current/fiscal-periods").then((res) => {
      const list = res.data;
      setPeriods(list);
      const now = Date.now();
      const current = list.find((p) => new Date(p.startDate).getTime() <= now && now <= new Date(p.endDate).getTime());
      setPeriodId(current?.id ?? list[0]?.id ?? "");
    });
  }, []);

  const load = useCallback(
    async (currentScope: "overall" | "period", fpId: string) => {
      if (!id || (currentScope === "period" && !fpId)) return;
      setLoading(true);
      setError(null);
      try {
        const query = currentScope === "period" ? `?fiscalPeriodId=${fpId}` : "";
        const res = await apiClient.get<TimesheetDetailResponse>(`/hr/employees/${id}/timesheet-detail${query}`);
        setDetail(res.data);
      } catch (err: any) {
        setError(err?.response?.data?.message ?? "Failed to load timesheet detail");
      } finally {
        setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    load(scope, periodId);
  }, [scope, periodId, load]);

  async function uploadAttachment(entryId: string, file: File) {
    setError(null);
    setUploadingFor(entryId);
    try {
      const form = new FormData();
      form.append("file", file);
      await apiClient.post(`/hr/employee-timesheet/entries/${entryId}/attachment`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      await load(scope, periodId);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to attach evidence — the file may be too large or an unsupported type");
    } finally {
      setUploadingFor(null);
    }
  }

  async function downloadPdfForPeriod() {
    if (!id || !detail || scope !== "period") return;
    const period = periods.find((p) => p.id === periodId);
    if (!period) return;
    setDownloadingPdf(true);
    setError(null);
    try {
      const employeeRes = await apiClient.get<{ designation?: string; iqamaOrNationalId?: string }>(`/hr/employees/${id}`);
      const companyName = companies.find((c) => c.companyId === user?.activeCompanyId)?.companyName ?? "";
      const periodLabel = new Date(period.startDate).toLocaleDateString(undefined, { month: "long", year: "numeric" });
      downloadEmployeeAttendancePdf({
        companyName,
        employeeName: detail.nameEn,
        employeeCode: detail.code,
        designation: employeeRes.data.designation,
        iqamaOrNationalId: employeeRes.data.iqamaOrNationalId,
        periodLabel,
        startDate: period.startDate,
        endDate: period.endDate,
        entries: detail.entries,
        totalHours: detail.totalHours,
      });
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to generate PDF");
    } finally {
      setDownloadingPdf(false);
    }
  }

  function viewAttachment(entryId: string, filename: string) {
    setViewer({ entryId, filename });
  }

  function closeViewer() {
    setViewer(null);
  }

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>
            {detail ? `${detail.code} — ${detail.nameEn} — Timesheets` : "Timesheets"}
          </h2>
          <span>
            {scope === "period" && detail && (
              <>
                <button className="secondary" disabled={downloadingPdf} onClick={downloadPdfForPeriod}>
                  {downloadingPdf ? "Preparing…" : "Download Attendance (PDF)"}
                </button>{" "}
              </>
            )}
            <button
              className="secondary"
              onClick={() =>
                navigate(
                  scope === "period" && periodId
                    ? `/hr/employees/timesheets?period=${periodId}&employee=${id}`
                    : `/hr/employees/timesheets?employee=${id}`,
                )
              }
            >
              Open in Update Timesheets
            </button>{" "}
            <button className="secondary" onClick={() => navigate(`/hr/employees/${id}`)}>
              Back to employee
            </button>
          </span>
        </div>
        <div className="form-row" style={{ marginTop: 10 }}>
          <button className={scope === "overall" ? "" : "secondary"} onClick={() => setScope("overall")}>
            Overall
          </button>
          <button className={scope === "period" ? "" : "secondary"} onClick={() => setScope("period")}>
            This period
          </button>
          {scope === "period" && (
            <select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  Period {p.periodNumber} ({new Date(p.startDate).toLocaleDateString()} – {new Date(p.endDate).toLocaleDateString()})
                </option>
              ))}
            </select>
          )}
        </div>
        {error && <div className="error-banner">{error}</div>}
      </div>

      {loading || !detail ? (
        <div className="card">
          <p>Loading…</p>
        </div>
      ) : (
        <>
          <div className="kpi-grid">
            <div className="kpi-tile" style={{ cursor: "default" }}>
              <span className="kpi-label">Total hours {scope === "overall" ? "(overall)" : "(period)"}</span>
              <span className="kpi-value">{Number(detail.totalHours).toFixed(0)}</span>
            </div>
            <div className="kpi-tile" style={{ cursor: "default" }}>
              <span className="kpi-label">Total cost</span>
              <span className="kpi-value">{money(detail.totalCost)}</span>
            </div>
            <div className="kpi-tile" style={{ cursor: "default" }}>
              <span className="kpi-label">Hourly rate</span>
              <span className="kpi-value">{money(detail.hourlyRate)}</span>
            </div>
          </div>

          <div className="card">
            <h3>Day-by-day record</h3>
            {detail.entries.length === 0 ? (
              <p>No timesheet entries {scope === "overall" ? "yet" : "for this period"}.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Day type</th>
                    <th>Hours</th>
                    <th>Cost</th>
                    <th>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.entries.map((e) => (
                    <tr key={e.id}>
                      <td>{new Date(e.date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", weekday: "short" })}</td>
                      <td>{DAY_TYPE_LABELS[e.dayType] ?? e.dayType}</td>
                      <td>{Number(e.hoursWorked)}</td>
                      <td>{money(e.cost)}</td>
                      <td>
                        {e.attachmentFilename ? (
                          <button className="secondary" onClick={() => viewAttachment(e.id, e.attachmentFilename!)}>
                            View
                          </button>
                        ) : (
                          <AttachButton uploading={uploadingFor === e.id} onFile={(file) => uploadAttachment(e.id, file)} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {viewer && (
        <AttachmentViewer
          filename={viewer.filename}
          fetchBlob={() =>
            apiClient
              .get(`/hr/employee-timesheet/entries/${viewer.entryId}/attachment`, { responseType: "blob" })
              .then((res) => res.data as Blob)
          }
          onClose={closeViewer}
        />
      )}
    </div>
  );
}
