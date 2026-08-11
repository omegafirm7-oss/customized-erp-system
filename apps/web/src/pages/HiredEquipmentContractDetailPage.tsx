import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiClient } from "../api/client";

interface Assignment {
  id: string;
  equipmentName: string;
  equipmentType: string | null;
  rateBasis: string;
  billRate: string;
  otBillRate: string;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
}

interface TimesheetRef {
  id: string;
  status: string;
  fiscalPeriod: { periodNumber: number; startDate: string; endDate: string };
  purchaseInvoice: { id: string; invoiceNumber: string | null; status: string } | null;
}

interface ContractDetail {
  id: string;
  code: string;
  name: string;
  status: string;
  startDate: string;
  memo: string | null;
  project: { id: string; code: string; name: string };
  businessPartner: { code: string; name: string };
  assignments: Assignment[];
  timesheets: TimesheetRef[];
}

interface FiscalPeriod {
  id: string;
  periodNumber: number;
  startDate: string;
  endDate: string;
  status: string;
}

export function HiredEquipmentContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [contract, setContract] = useState<ContractDetail | null>(null);
  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [assignmentForm, setAssignmentForm] = useState({
    equipmentName: "",
    equipmentType: "",
    rateBasis: "DAILY",
    billRate: "",
    otBillRate: "",
    startDate: new Date().toISOString().slice(0, 10),
  });

  const load = useCallback(async () => {
    const [contractRes, periodsRes] = await Promise.all([
      apiClient.get<ContractDetail>(`/hired-equipment/contracts/${id}`),
      apiClient.get<FiscalPeriod[]>("/companies/current/fiscal-periods"),
    ]);
    setContract(contractRes.data);
    setPeriods(periodsRes.data.filter((p) => p.status !== "CLOSED"));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function addAssignment(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiClient.post(`/hired-equipment/contracts/${id}/assignments`, {
        equipmentName: assignmentForm.equipmentName,
        equipmentType: assignmentForm.equipmentType || undefined,
        rateBasis: assignmentForm.rateBasis,
        billRate: assignmentForm.billRate,
        otBillRate: assignmentForm.otBillRate || "0",
        startDate: assignmentForm.startDate,
      });
      setAssignmentForm({ ...assignmentForm, equipmentName: "", equipmentType: "", billRate: "", otBillRate: "" });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to add equipment");
    }
  }

  async function endAssignment(assignmentId: string) {
    setError(null);
    try {
      await apiClient.patch(`/hired-equipment/contracts/${id}/assignments/${assignmentId}`, { isActive: false });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to end assignment");
    }
  }

  async function createTimesheet() {
    if (!selectedPeriodId) return;
    setError(null);
    try {
      await apiClient.post(`/hired-equipment/contracts/${id}/timesheets`, { fiscalPeriodId: selectedPeriodId });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create timesheet");
    }
  }

  async function closeContract() {
    if (!window.confirm("Close this contract?")) return;
    setError(null);
    try {
      await apiClient.post(`/hired-equipment/contracts/${id}/close`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to close contract");
    }
  }

  if (!contract) return <p>Loading…</p>;
  const isActive = contract.status === "ACTIVE";

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>
            {contract.code} — {contract.name}{" "}
            <span className={`badge ${isActive ? "posted" : "reversed"}`}>{contract.status}</span>
          </h2>
          {isActive && (
            <button className="secondary" onClick={closeContract}>
              Close contract
            </button>
          )}
        </div>
        {error && <div className="error-banner">{error}</div>}
        <p style={{ color: "#667085", fontSize: 13 }}>
          Vendor {contract.businessPartner.name} · Project{" "}
          <Link to={`/projects/${contract.project.id}`}>{contract.project.code} — {contract.project.name}</Link> · Since{" "}
          {new Date(contract.startDate).toLocaleDateString()}
        </p>
      </div>

      <div className="card">
        <h3>Rented units</h3>
        {contract.assignments.length === 0 ? (
          <p>No equipment added yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Equipment</th>
                <th>Basis</th>
                <th>Bill rate</th>
                <th>OT rate</th>
                <th>From</th>
                <th>To</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {contract.assignments.map((a) => (
                <tr key={a.id}>
                  <td>
                    {a.equipmentName}
                    {a.equipmentType ? ` (${a.equipmentType})` : ""}
                  </td>
                  <td>{a.rateBasis}</td>
                  <td>{Number(a.billRate).toFixed(2)}</td>
                  <td>{Number(a.otBillRate) > 0 ? Number(a.otBillRate).toFixed(2) : "—"}</td>
                  <td>{new Date(a.startDate).toLocaleDateString()}</td>
                  <td>{a.endDate ? new Date(a.endDate).toLocaleDateString() : "—"}</td>
                  <td>
                    <span className={`badge ${a.isActive ? "posted" : "reversed"}`}>{a.isActive ? "ACTIVE" : "ENDED"}</span>
                  </td>
                  <td>
                    {a.isActive && isActive && (
                      <button className="secondary" onClick={() => endAssignment(a.id)}>
                        End
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {isActive && (
          <form onSubmit={addAssignment}>
            <div className="form-row" style={{ marginTop: 10 }}>
              <input
                placeholder="Equipment (e.g. 20T Excavator — Plate ABC123)"
                value={assignmentForm.equipmentName}
                onChange={(e) => setAssignmentForm({ ...assignmentForm, equipmentName: e.target.value })}
                required
                style={{ flex: 1 }}
              />
              <input
                placeholder="Type (optional)"
                value={assignmentForm.equipmentType}
                onChange={(e) => setAssignmentForm({ ...assignmentForm, equipmentType: e.target.value })}
                style={{ width: 140 }}
              />
              <select value={assignmentForm.rateBasis} onChange={(e) => setAssignmentForm({ ...assignmentForm, rateBasis: e.target.value })}>
                <option value="HOURLY">Hourly</option>
                <option value="DAILY">Daily</option>
                <option value="MONTHLY">Monthly</option>
              </select>
              <input type="number" min="0" step="0.01" placeholder="Bill rate" value={assignmentForm.billRate} onChange={(e) => setAssignmentForm({ ...assignmentForm, billRate: e.target.value })} required style={{ width: 100 }} />
              <input type="number" min="0" step="0.01" placeholder="OT rate/hr" value={assignmentForm.otBillRate} onChange={(e) => setAssignmentForm({ ...assignmentForm, otBillRate: e.target.value })} style={{ width: 100 }} />
              <div>
                <label>From </label>
                <input type="date" value={assignmentForm.startDate} onChange={(e) => setAssignmentForm({ ...assignmentForm, startDate: e.target.value })} required />
              </div>
              <button type="submit">Add</button>
            </div>
          </form>
        )}
      </div>

      <div className="card">
        <h3>Timesheets</h3>
        {isActive && (
          <div className="form-row">
            <select value={selectedPeriodId} onChange={(e) => setSelectedPeriodId(e.target.value)}>
              <option value="" disabled>
                Select fiscal period…
              </option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  Period {p.periodNumber} ({new Date(p.startDate).toLocaleDateString()} –{" "}
                  {new Date(p.endDate).toLocaleDateString()})
                </option>
              ))}
            </select>
            <button onClick={createTimesheet} disabled={!selectedPeriodId}>
              New timesheet (prefilled)
            </button>
          </div>
        )}
        {contract.timesheets.length === 0 ? (
          <p>No timesheets yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Period</th>
                <th>Status</th>
                <th>Invoice</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {contract.timesheets.map((ts) => (
                <tr key={ts.id}>
                  <td>P{ts.fiscalPeriod.periodNumber}</td>
                  <td>
                    <span className={`badge ${ts.status === "INVOICED" ? "posted" : "draft"}`}>{ts.status}</span>
                  </td>
                  <td>
                    {ts.purchaseInvoice ? (
                      <>
                        {ts.purchaseInvoice.invoiceNumber ?? "(draft)"}{" "}
                        <span className={`badge ${ts.purchaseInvoice.status === "CANCELLED" ? "reversed" : "posted"}`}>
                          {ts.purchaseInvoice.status}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <Link to={`/hired-equipment/timesheets/${ts.id}`}>Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
