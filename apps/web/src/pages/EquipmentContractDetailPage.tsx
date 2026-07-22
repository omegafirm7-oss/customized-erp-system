import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiClient } from "../api/client";

interface Assignment {
  id: string;
  rateBasis: string;
  billRate: string;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  equipment: { code: string; name: string; status: string };
}

interface UsageLogRef {
  id: string;
  status: string;
  fiscalPeriod: { periodNumber: number; startDate: string; endDate: string };
  salesInvoice: { id: string; invoiceNumber: string | null; status: string } | null;
}

interface ContractDetail {
  id: string;
  code: string;
  name: string;
  status: string;
  startDate: string;
  costCenter: { code: string };
  businessPartner: { code: string; name: string };
  assignments: Assignment[];
  usageLogs: UsageLogRef[];
}

interface EquipmentRef {
  id: string;
  code: string;
  name: string;
  status: string;
}

interface FiscalPeriod {
  id: string;
  periodNumber: number;
  startDate: string;
  endDate: string;
  status: string;
}

export function EquipmentContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [contract, setContract] = useState<ContractDetail | null>(null);
  const [units, setUnits] = useState<EquipmentRef[]>([]);
  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [assignmentForm, setAssignmentForm] = useState({
    equipmentId: "",
    rateBasis: "MONTHLY",
    billRate: "",
    startDate: new Date().toISOString().slice(0, 10),
  });

  const load = useCallback(async () => {
    const [contractRes, unitsRes, periodsRes] = await Promise.all([
      apiClient.get<ContractDetail>(`/equipment/contracts/${id}`),
      apiClient.get<EquipmentRef[]>("/equipment/units?status=ACTIVE"),
      apiClient.get<FiscalPeriod[]>("/companies/current/fiscal-periods"),
    ]);
    setContract(contractRes.data);
    setUnits(unitsRes.data);
    setPeriods(periodsRes.data.filter((p) => p.status !== "CLOSED"));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function addAssignment(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiClient.post(`/equipment/contracts/${id}/assignments`, assignmentForm);
      setAssignmentForm({ ...assignmentForm, equipmentId: "", billRate: "" });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to add assignment");
    }
  }

  async function endAssignment(assignmentId: string) {
    setError(null);
    try {
      await apiClient.patch(`/equipment/contracts/${id}/assignments/${assignmentId}`, { isActive: false });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to end assignment");
    }
  }

  async function createUsageLog() {
    if (!selectedPeriodId) return;
    setError(null);
    try {
      await apiClient.post(`/equipment/contracts/${id}/usage-logs`, { fiscalPeriodId: selectedPeriodId });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create usage log");
    }
  }

  async function closeContract() {
    if (!window.confirm("Close this contract? Its cost center will be deactivated.")) return;
    setError(null);
    try {
      await apiClient.post(`/equipment/contracts/${id}/close`);
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
          Cost center {contract.costCenter.code} · Customer {contract.businessPartner.name} · Since{" "}
          {new Date(contract.startDate).toLocaleDateString()}
        </p>
      </div>

      <div className="card">
        <h3>Assigned units</h3>
        {contract.assignments.length === 0 ? (
          <p>No units assigned yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Equipment</th>
                <th>Basis</th>
                <th>Bill rate</th>
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
                    {a.equipment.code} — {a.equipment.name}
                  </td>
                  <td>{a.rateBasis}</td>
                  <td>{Number(a.billRate).toFixed(2)}</td>
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
              <select
                value={assignmentForm.equipmentId}
                onChange={(e) => setAssignmentForm({ ...assignmentForm, equipmentId: e.target.value })}
                required
              >
                <option value="" disabled>
                  Select equipment…
                </option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code} — {u.name}
                  </option>
                ))}
              </select>
              <select value={assignmentForm.rateBasis} onChange={(e) => setAssignmentForm({ ...assignmentForm, rateBasis: e.target.value })}>
                <option value="HOURLY">Hourly</option>
                <option value="DAILY">Daily</option>
                <option value="MONTHLY">Monthly</option>
              </select>
              <input type="number" min="0" step="0.01" placeholder="Bill rate" value={assignmentForm.billRate} onChange={(e) => setAssignmentForm({ ...assignmentForm, billRate: e.target.value })} required style={{ width: 100 }} />
              <div>
                <label>From </label>
                <input type="date" value={assignmentForm.startDate} onChange={(e) => setAssignmentForm({ ...assignmentForm, startDate: e.target.value })} required />
              </div>
              <button type="submit">Assign</button>
            </div>
          </form>
        )}
      </div>

      <div className="card">
        <h3>Usage logs</h3>
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
            <button onClick={createUsageLog} disabled={!selectedPeriodId}>
              New usage log (prefilled)
            </button>
          </div>
        )}
        {contract.usageLogs.length === 0 ? (
          <p>No usage logs yet.</p>
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
              {contract.usageLogs.map((log) => (
                <tr key={log.id}>
                  <td>P{log.fiscalPeriod.periodNumber}</td>
                  <td>
                    <span className={`badge ${log.status === "INVOICED" ? "posted" : "draft"}`}>{log.status}</span>
                  </td>
                  <td>
                    {log.salesInvoice ? (
                      <>
                        {log.salesInvoice.invoiceNumber ?? "(draft)"}{" "}
                        <span className={`badge ${log.salesInvoice.status === "CANCELLED" ? "reversed" : "posted"}`}>
                          {log.salesInvoice.status}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <Link to={`/equipment/usage-logs/${log.id}`}>Open</Link>
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
