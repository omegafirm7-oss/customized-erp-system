import { FormEvent, useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiClient } from "../api/client";

interface Loan {
  id: string;
  loanNumber: string;
  principal: string;
  monthlyInstallment: string;
  balance: string;
  status: string;
}

interface SettlementPayment {
  id: string;
  amount: string;
  paymentDate: string;
  memo: string | null;
}

interface PaymentRecovery {
  id: string;
  amount: string;
  recoveryDate: string;
  memo: string | null;
}

interface EmployeePayment {
  id: string;
  paymentNumber: string | null;
  category: string;
  amount: string;
  recoveredAmount: string;
  paymentDate: string;
  memo: string | null;
  recoveries: PaymentRecovery[];
}

interface EmployeeDetail {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  designation: string | null;
  nationality: string | null;
  isSaudi: boolean;
  gender: string | null;
  dateOfBirth: string | null;
  iqamaOrNationalId: string | null;
  iqamaExpiry: string | null;
  passportNumber: string | null;
  passportExpiry: string | null;
  gosiNumber: string | null;
  joinDate: string;
  contractType: string;
  status: string;
  terminationDate: string | null;
  bankCode: string | null;
  iban: string | null;
  annualLeaveDays: string;
  leaveOpeningBalance: string;
  basicSalary: string;
  housingAllowance: string;
  transportAllowance: string;
  otherAllowance: string;
  gosiExempt: boolean;
  costCenter: { id: string; code: string; name: string } | null;
  loans: Loan[];
  finalSettlement: {
    id: string;
    settlementNumber: string;
    reason: string;
    netAmount: string;
    paidAmount: string;
    status: string;
    payments: SettlementPayment[];
  } | null;
}

interface EmployeeSummary {
  paidSalary: string;
  paidAdvance: string;
  paidAllowance: string;
  totalPaid: string;
  pendingSalary: string;
  pendingAllowance: string;
  pendingLaborAccrual: string;
  loanBalance: string;
  settlementPending: string;
  totalPending: string;
  workedDays: number;
  workedHours: string;
  absentDays: number;
  unpaidLeaveDays: number;
}

interface Account {
  id: string;
  code: string;
  name: string;
  controlAccountType: string | null;
  isPostable: boolean;
  isActive: boolean;
  accountClass?: { code: string; name: string };
}

interface CostCenter {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

interface SettlementPreview {
  serviceYears: string;
  finalSalaryDays: number;
  finalSalaryAmount: string;
  eosbAmount: string;
  leaveBalanceDays: string;
  leavePayoutAmount: string;
  loanRecovery: string;
  netAmount: string;
}

function toDateInput(v: string | null): string {
  return v ? v.slice(0, 10) : "";
}

function money(v: string | number): string {
  return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const emptyDetailsForm = {
  code: "",
  nameEn: "",
  nameAr: "",
  designation: "",
  nationality: "",
  isSaudi: false,
  gender: "",
  dateOfBirth: "",
  iqamaOrNationalId: "",
  iqamaExpiry: "",
  passportNumber: "",
  passportExpiry: "",
  gosiNumber: "",
  gosiExempt: false,
  joinDate: "",
  contractType: "UNLIMITED",
  bankCode: "",
  iban: "",
  costCenterId: "",
  annualLeaveDays: "",
  leaveOpeningBalance: "",
  basicSalary: "",
  housingAllowance: "",
  transportAllowance: "",
  otherAllowance: "",
};

export function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [employee, setEmployee] = useState<EmployeeDetail | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<Account[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [detailsForm, setDetailsForm] = useState(emptyDetailsForm);
  const [loanForm, setLoanForm] = useState({ principal: "", monthlyInstallment: "", disbursementAccountId: "" });

  const [showRelease, setShowRelease] = useState(false);
  const [termForm, setTermForm] = useState({ reason: "RESIGNATION", lastWorkingDay: new Date().toISOString().slice(0, 10) });
  const [preview, setPreview] = useState<SettlementPreview | null>(null);
  const [paymentForm, setPaymentForm] = useState({ amount: "", bankCashAccountId: "", paymentDate: new Date().toISOString().slice(0, 10) });

  const [summary, setSummary] = useState<EmployeeSummary | null>(null);
  const [showPaidBreakdown, setShowPaidBreakdown] = useState(false);
  const [showPendingBreakdown, setShowPendingBreakdown] = useState(false);
  const [payments, setPayments] = useState<EmployeePayment[]>([]);
  const [payForm, setPayForm] = useState({
    category: "ALLOWANCE",
    amount: "",
    bankCashAccountId: "",
    expenseAccountId: "",
    paymentDate: new Date().toISOString().slice(0, 10),
    memo: "",
  });
  const [recoveryOpenId, setRecoveryOpenId] = useState<string | null>(null);
  const [recoveryForm, setRecoveryForm] = useState({ amount: "", bankCashAccountId: "", recoveryDate: new Date().toISOString().slice(0, 10) });

  const load = useCallback(async () => {
    const [empRes, accountsRes, ccRes, paymentsRes, summaryRes] = await Promise.all([
      apiClient.get<EmployeeDetail>(`/hr/employees/${id}`),
      apiClient.get<Account[]>("/coa/accounts"),
      apiClient.get<CostCenter[]>("/cost-centers"),
      apiClient.get<EmployeePayment[]>(`/hr/employees/${id}/payments`),
      apiClient.get<EmployeeSummary>(`/hr/employees/${id}/summary`),
    ]);
    setPayments(paymentsRes.data);
    setSummary(summaryRes.data);
    const e = empRes.data;
    setEmployee(e);
    setDetailsForm({
      code: e.code,
      nameEn: e.nameEn,
      nameAr: e.nameAr ?? "",
      designation: e.designation ?? "",
      nationality: e.nationality ?? "",
      isSaudi: e.isSaudi,
      gender: e.gender ?? "",
      dateOfBirth: toDateInput(e.dateOfBirth),
      iqamaOrNationalId: e.iqamaOrNationalId ?? "",
      iqamaExpiry: toDateInput(e.iqamaExpiry),
      passportNumber: e.passportNumber ?? "",
      passportExpiry: toDateInput(e.passportExpiry),
      gosiNumber: e.gosiNumber ?? "",
      gosiExempt: e.gosiExempt,
      joinDate: toDateInput(e.joinDate),
      contractType: e.contractType,
      bankCode: e.bankCode ?? "",
      iban: e.iban ?? "",
      costCenterId: e.costCenter?.id ?? "",
      annualLeaveDays: e.annualLeaveDays,
      leaveOpeningBalance: e.leaveOpeningBalance,
      basicSalary: e.basicSalary,
      housingAllowance: e.housingAllowance,
      transportAllowance: e.transportAllowance,
      otherAllowance: e.otherAllowance,
    });
    setAccounts(
      accountsRes.data.filter(
        (a) => a.isActive && a.isPostable && (a.controlAccountType === "BANK" || a.controlAccountType === "CASH"),
      ),
    );
    setExpenseAccounts(accountsRes.data.filter((a) => a.isActive && a.isPostable && a.accountClass?.code === "EXPENSE"));
    setCostCenters(ccRes.data.filter((c) => c.isActive));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveDetails(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await apiClient.patch(`/hr/employees/${id}`, {
        ...detailsForm,
        nameAr: detailsForm.nameAr || undefined,
        designation: detailsForm.designation || undefined,
        nationality: detailsForm.nationality || undefined,
        gender: detailsForm.gender || undefined,
        dateOfBirth: detailsForm.dateOfBirth || undefined,
        iqamaOrNationalId: detailsForm.iqamaOrNationalId || undefined,
        iqamaExpiry: detailsForm.iqamaExpiry || undefined,
        passportNumber: detailsForm.passportNumber || undefined,
        passportExpiry: detailsForm.passportExpiry || undefined,
        gosiNumber: detailsForm.gosiNumber || undefined,
        bankCode: detailsForm.bankCode || undefined,
        iban: detailsForm.iban || undefined,
        costCenterId: detailsForm.costCenterId || undefined,
      });
      setSaved(true);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to save employee details");
    }
  }

  async function deleteEmployee() {
    if (!window.confirm(`Permanently delete ${employee?.code} — ${employee?.nameEn}? This cannot be undone.`)) return;
    setError(null);
    try {
      await apiClient.delete(`/hr/employees/${id}`);
      navigate("/hr/employees");
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to delete employee");
    }
  }

  async function createLoan(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiClient.post(`/hr/employees/${id}/loans`, loanForm);
      setLoanForm({ principal: "", monthlyInstallment: "", disbursementAccountId: "" });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create loan");
    }
  }

  async function cancelLoan(loanId: string) {
    setError(null);
    try {
      await apiClient.post(`/hr/loans/${loanId}/cancel`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to cancel loan");
    }
  }

  async function previewSettlement() {
    setError(null);
    try {
      const res = await apiClient.post<SettlementPreview>(`/hr/employees/${id}/termination/preview`, termForm);
      setPreview(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Preview failed");
    }
  }

  async function postSettlement() {
    setError(null);
    try {
      await apiClient.post(`/hr/employees/${id}/termination`, termForm);
      setPreview(null);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Settlement failed");
    }
  }

  async function reverseSettlement() {
    if (!employee?.finalSettlement) return;
    setError(null);
    try {
      await apiClient.post(`/hr/settlements/${employee.finalSettlement.id}/reverse`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Reverse failed");
    }
  }

  async function recordPayment(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiClient.post(`/hr/employees/${id}/release/payments`, paymentForm);
      setPaymentForm({ amount: "", bankCashAccountId: "", paymentDate: new Date().toISOString().slice(0, 10) });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to record payment");
    }
  }

  async function createPayment(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiClient.post(`/hr/employees/${id}/payments`, {
        ...payForm,
        expenseAccountId: payForm.category === "ALLOWANCE" && payForm.expenseAccountId ? payForm.expenseAccountId : undefined,
        memo: payForm.memo || undefined,
      });
      setPayForm({
        category: "ALLOWANCE",
        amount: "",
        bankCashAccountId: "",
        expenseAccountId: "",
        paymentDate: new Date().toISOString().slice(0, 10),
        memo: "",
      });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to record payment");
    }
  }

  async function recordRecovery(paymentId: string) {
    setError(null);
    try {
      await apiClient.post(`/hr/employee-payments/${paymentId}/recoveries`, recoveryForm);
      setRecoveryForm({ amount: "", bankCashAccountId: "", recoveryDate: new Date().toISOString().slice(0, 10) });
      setRecoveryOpenId(null);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to record recovery");
    }
  }

  if (!employee) return <p>Loading…</p>;

  const active = employee.status === "ACTIVE";
  const set = (key: keyof typeof detailsForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDetailsForm({ ...detailsForm, [key]: e.target.value });
  const setChecked = (key: keyof typeof detailsForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDetailsForm({ ...detailsForm, [key]: e.target.checked });

  // A REVERSED settlement carries no real pending balance — only show one
  // for a still-POSTED settlement.
  const pendingAmount =
    employee.finalSettlement && employee.finalSettlement.status === "POSTED"
      ? (Number(employee.finalSettlement.netAmount) - Number(employee.finalSettlement.paidAmount)).toFixed(2)
      : "0.00";

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>
            {employee.code} — {employee.nameEn}{" "}
            <span className={`badge ${active ? "posted" : "reversed"}`}>{employee.status}</span>
          </h2>
          <span>
            <button className="secondary" onClick={() => navigate(`/hr/employees/${id}/timesheets`)}>
              Timesheets
            </button>{" "}
            {active && (
              <button className="secondary" onClick={() => setShowRelease((v) => !v)}>
                Release Employee
              </button>
            )}{" "}
            <button className="secondary" style={{ color: "#912018", borderColor: "#912018" }} onClick={deleteEmployee}>
              Delete employee
            </button>
          </span>
        </div>
        {error && <div className="error-banner">{error}</div>}
        {saved && <p style={{ color: "#027a48" }}>Saved.</p>}
      </div>

      {summary && (
        <>
          <div className="kpi-grid">
            <button className="kpi-tile" onClick={() => setShowPaidBreakdown((v) => !v)}>
              <span className="kpi-label">Paid</span>
              <span className="kpi-value">{money(summary.totalPaid)}</span>
            </button>
            <button className="kpi-tile" onClick={() => setShowPendingBreakdown((v) => !v)}>
              <span className="kpi-label">Pending</span>
              <span className="kpi-value">{money(summary.totalPending)}</span>
            </button>
            <div className="kpi-tile" style={{ cursor: "default" }}>
              <span className="kpi-label">Days worked / hours</span>
              <span className="kpi-value">
                {summary.workedDays} / {Number(summary.workedHours).toFixed(0)}h
              </span>
            </div>
            <div className="kpi-tile" style={{ cursor: "default" }}>
              <span className="kpi-label">Absent / unpaid leave days</span>
              <span className="kpi-value">
                {summary.absentDays} / {summary.unpaidLeaveDays}
              </span>
            </div>
          </div>
          {showPaidBreakdown && (
            <div className="card" style={{ marginTop: -10 }}>
              <div className="form-row" style={{ justifyContent: "space-between" }}>
                <span>Paid — salary (posted payroll net pay)</span>
                <strong>{money(summary.paidSalary)}</strong>
              </div>
              <div className="form-row" style={{ justifyContent: "space-between" }}>
                <span>Paid — advances</span>
                <strong>{money(summary.paidAdvance)}</strong>
              </div>
              <div className="form-row" style={{ justifyContent: "space-between" }}>
                <span>Paid — allowances</span>
                <strong>{money(summary.paidAllowance)}</strong>
              </div>
            </div>
          )}
          {showPendingBreakdown && (
            <div className="card" style={{ marginTop: -10 }}>
              <div className="form-row" style={{ justifyContent: "space-between" }}>
                <span>Pending — salary (unpaid logged hours{employee.finalSettlement ? " + settlement" : ""})</span>
                <strong>{money(summary.pendingSalary)}</strong>
              </div>
              <div className="form-row" style={{ justifyContent: "space-between", paddingLeft: 20, fontSize: 13, color: "#667085" }}>
                <span>— of which unpaid logged hours (from timesheets, not yet covered by payroll)</span>
                <span>{money(summary.pendingLaborAccrual)}</span>
              </div>
              {employee.finalSettlement && employee.finalSettlement.status === "POSTED" && (
                <div className="form-row" style={{ justifyContent: "space-between", paddingLeft: 20, fontSize: 13, color: "#667085" }}>
                  <span>— of which unpaid settlement</span>
                  <span>{money(summary.settlementPending)}</span>
                </div>
              )}
              <div className="form-row" style={{ justifyContent: "space-between" }}>
                <span>Pending — allowance/advance (unrecovered)</span>
                <strong>{money(summary.pendingAllowance)}</strong>
              </div>
              <div className="form-row" style={{ justifyContent: "space-between" }}>
                <span>Pending — active loans (see Loans &amp; advances below)</span>
                <strong>{money(summary.loanBalance)}</strong>
              </div>
            </div>
          )}
        </>
      )}

      <div className="card">
        <h3>Employee details</h3>
        <form onSubmit={saveDetails}>
          <h4>Identity</h4>
          <div className="form-row">
            <input placeholder="Code" value={detailsForm.code} onChange={set("code")} required disabled={!active} style={{ width: 100 }} />
            <input placeholder="Name (English)" value={detailsForm.nameEn} onChange={set("nameEn")} required disabled={!active} style={{ flex: 1 }} />
            <input placeholder="Name (Arabic)" value={detailsForm.nameAr} onChange={set("nameAr")} disabled={!active} style={{ flex: 1 }} />
            <input placeholder="Designation / Trade" value={detailsForm.designation} onChange={set("designation")} disabled={!active} style={{ width: 140 }} />
          </div>
          <div className="form-row">
            <input placeholder="Nationality" value={detailsForm.nationality} onChange={set("nationality")} disabled={!active} style={{ width: 100 }} />
            <label>
              <input type="checkbox" checked={detailsForm.isSaudi} onChange={setChecked("isSaudi")} disabled={!active} /> Saudi
            </label>
            <select value={detailsForm.gender} onChange={set("gender")} disabled={!active}>
              <option value="">Gender…</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
            </select>
            <div>
              <label>DOB </label>
              <input type="date" value={detailsForm.dateOfBirth} onChange={set("dateOfBirth")} disabled={!active} />
            </div>
          </div>

          <h4>Documents</h4>
          <div className="form-row">
            <input placeholder="Iqama / National ID" value={detailsForm.iqamaOrNationalId} onChange={set("iqamaOrNationalId")} disabled={!active} />
            <div>
              <label>Iqama expiry </label>
              <input type="date" value={detailsForm.iqamaExpiry} onChange={set("iqamaExpiry")} disabled={!active} />
            </div>
            <input placeholder="Passport number" value={detailsForm.passportNumber} onChange={set("passportNumber")} disabled={!active} />
            <div>
              <label>Passport expiry </label>
              <input type="date" value={detailsForm.passportExpiry} onChange={set("passportExpiry")} disabled={!active} />
            </div>
          </div>
          <div className="form-row">
            <input placeholder="GOSI number" value={detailsForm.gosiNumber} onChange={set("gosiNumber")} disabled={!active} />
            <label>
              <input type="checkbox" checked={detailsForm.gosiExempt} onChange={setChecked("gosiExempt")} disabled={!active} /> GOSI exempt
            </label>
          </div>

          <h4>Payroll setup</h4>
          <div className="form-row">
            <div>
              <label>Joined </label>
              <input type="date" value={detailsForm.joinDate} onChange={set("joinDate")} required disabled={!active} />
            </div>
            <select value={detailsForm.contractType} onChange={set("contractType")} disabled={!active}>
              <option value="UNLIMITED">Unlimited</option>
              <option value="LIMITED">Limited</option>
            </select>
            <select value={detailsForm.costCenterId} onChange={set("costCenterId")} disabled={!active}>
              <option value="">No cost center</option>
              {costCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <input placeholder="Bank code" value={detailsForm.bankCode} onChange={set("bankCode")} disabled={!active} style={{ width: 90 }} />
            <input placeholder="IBAN" value={detailsForm.iban} onChange={set("iban")} disabled={!active} style={{ flex: 1 }} />
            <div>
              <label>Annual leave days </label>
              <input type="number" min="0" step="0.5" value={detailsForm.annualLeaveDays} onChange={set("annualLeaveDays")} disabled={!active} style={{ width: 80 }} />
            </div>
            <div>
              <label>Leave opening balance </label>
              <input type="number" min="0" step="0.5" value={detailsForm.leaveOpeningBalance} onChange={set("leaveOpeningBalance")} disabled={!active} style={{ width: 80 }} />
            </div>
          </div>

          <h4>Salary structure</h4>
          <div className="form-row">
            <div>
              <label>Basic </label>
              <input type="number" min="0" step="0.01" value={detailsForm.basicSalary} onChange={set("basicSalary")} disabled={!active} />
            </div>
            <div>
              <label>Housing </label>
              <input type="number" min="0" step="0.01" value={detailsForm.housingAllowance} onChange={set("housingAllowance")} disabled={!active} />
            </div>
            <div>
              <label>Transport </label>
              <input type="number" min="0" step="0.01" value={detailsForm.transportAllowance} onChange={set("transportAllowance")} disabled={!active} />
            </div>
            <div>
              <label>Other </label>
              <input type="number" min="0" step="0.01" value={detailsForm.otherAllowance} onChange={set("otherAllowance")} disabled={!active} />
            </div>
            <button type="submit" disabled={!active}>
              Save
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h3>Loans &amp; advances</h3>
        {employee.loans.length === 0 ? (
          <p>No loans.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Number</th>
                <th>Principal</th>
                <th>Installment</th>
                <th>Balance</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {employee.loans.map((loan) => (
                <tr key={loan.id}>
                  <td>{loan.loanNumber}</td>
                  <td>{Number(loan.principal).toFixed(2)}</td>
                  <td>{Number(loan.monthlyInstallment).toFixed(2)}</td>
                  <td>{Number(loan.balance).toFixed(2)}</td>
                  <td>
                    <span className={`badge ${loan.status === "ACTIVE" ? "posted" : "draft"}`}>{loan.status}</span>
                  </td>
                  <td>
                    {loan.status === "ACTIVE" && Number(loan.balance) === Number(loan.principal) && (
                      <button className="secondary" onClick={() => cancelLoan(loan.id)}>
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {active && (
          <form onSubmit={createLoan}>
            <div className="form-row" style={{ marginTop: 10 }}>
              <input type="number" min="0.01" step="0.01" placeholder="Principal" value={loanForm.principal} onChange={(e) => setLoanForm({ ...loanForm, principal: e.target.value })} required />
              <input type="number" min="0.01" step="0.01" placeholder="Monthly installment" value={loanForm.monthlyInstallment} onChange={(e) => setLoanForm({ ...loanForm, monthlyInstallment: e.target.value })} required />
              <select value={loanForm.disbursementAccountId} onChange={(e) => setLoanForm({ ...loanForm, disbursementAccountId: e.target.value })} required>
                <option value="" disabled>
                  Pay from…
                </option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
              <button type="submit">Disburse loan</button>
            </div>
          </form>
        )}
      </div>

      <div className="card">
        <h3>Payments (allowances &amp; advances)</h3>
        <p style={{ color: "#667085", fontSize: 13 }}>
          Informal cash paid outside payroll. Allowances are a straight expense; advances/other stay pending until
          recovered. Kept separate from Loans (the formal, installment-deducted path) above.
        </p>
        {payments.length === 0 ? (
          <p>No payments recorded.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Number</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Recovered</th>
                <th>Pending</th>
                <th>Date</th>
                <th>Memo</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                const pending = (Number(p.amount) - Number(p.recoveredAmount)).toFixed(2);
                const recoverable = p.category !== "ALLOWANCE" && Number(pending) > 0;
                return (
                  <>
                    <tr key={p.id}>
                      <td>{p.paymentNumber ?? "—"}</td>
                      <td>{p.category}</td>
                      <td>{Number(p.amount).toFixed(2)}</td>
                      <td>{Number(p.recoveredAmount).toFixed(2)}</td>
                      <td>{p.category === "ALLOWANCE" ? "—" : pending}</td>
                      <td>{new Date(p.paymentDate).toLocaleDateString()}</td>
                      <td>{p.memo ?? "—"}</td>
                      <td>
                        {recoverable && (
                          <button className="secondary" onClick={() => setRecoveryOpenId(recoveryOpenId === p.id ? null : p.id)}>
                            {recoveryOpenId === p.id ? "Cancel" : "Record recovery"}
                          </button>
                        )}
                      </td>
                    </tr>
                    {recoveryOpenId === p.id && (
                      <tr>
                        <td colSpan={8}>
                          <div className="form-row" style={{ margin: "6px 0" }}>
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              placeholder="Amount"
                              value={recoveryForm.amount}
                              onChange={(e) => setRecoveryForm({ ...recoveryForm, amount: e.target.value })}
                              style={{ width: 110 }}
                            />
                            <select
                              value={recoveryForm.bankCashAccountId}
                              onChange={(e) => setRecoveryForm({ ...recoveryForm, bankCashAccountId: e.target.value })}
                            >
                              <option value="" disabled>
                                Received into…
                              </option>
                              {accounts.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.code} — {a.name}
                                </option>
                              ))}
                            </select>
                            <input
                              type="date"
                              value={recoveryForm.recoveryDate}
                              onChange={(e) => setRecoveryForm({ ...recoveryForm, recoveryDate: e.target.value })}
                            />
                            <button onClick={() => recordRecovery(p.id)}>Save recovery</button>
                          </div>
                          {p.recoveries.length > 0 && (
                            <table>
                              <thead>
                                <tr>
                                  <th>Date</th>
                                  <th>Amount</th>
                                  <th>Memo</th>
                                </tr>
                              </thead>
                              <tbody>
                                {p.recoveries.map((r) => (
                                  <tr key={r.id}>
                                    <td>{new Date(r.recoveryDate).toLocaleDateString()}</td>
                                    <td>{Number(r.amount).toFixed(2)}</td>
                                    <td>{r.memo ?? "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
        {active && (
          <form onSubmit={createPayment}>
            <div className="form-row" style={{ marginTop: 10 }}>
              <select value={payForm.category} onChange={(e) => setPayForm({ ...payForm, category: e.target.value })}>
                <option value="ALLOWANCE">Allowance</option>
                <option value="ADVANCE">Advance</option>
                <option value="OTHER">Other</option>
              </select>
              <input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="Amount"
                value={payForm.amount}
                onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                required
                style={{ width: 110 }}
              />
              <select
                value={payForm.bankCashAccountId}
                onChange={(e) => setPayForm({ ...payForm, bankCashAccountId: e.target.value })}
                required
              >
                <option value="" disabled>
                  Pay from…
                </option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
              {payForm.category === "ALLOWANCE" && (
                <select
                  value={payForm.expenseAccountId}
                  onChange={(e) => setPayForm({ ...payForm, expenseAccountId: e.target.value })}
                >
                  <option value="">Expense account (default: Allowance Expense)</option>
                  {expenseAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
              )}
              <input
                type="date"
                value={payForm.paymentDate}
                onChange={(e) => setPayForm({ ...payForm, paymentDate: e.target.value })}
                required
              />
              <input
                placeholder="Memo"
                value={payForm.memo}
                onChange={(e) => setPayForm({ ...payForm, memo: e.target.value })}
                style={{ flex: 1 }}
              />
              <button type="submit">Record payment</button>
            </div>
          </form>
        )}
      </div>

      {(showRelease || employee.finalSettlement || !active) && (
        <div className="card">
          <h3>Release Employee</h3>
          {employee.finalSettlement && (
            <>
              <table>
                <tbody>
                  <tr>
                    <td>Settlement</td>
                    <td>
                      {employee.finalSettlement.settlementNumber} ({employee.finalSettlement.reason}){" "}
                      <span className={`badge ${employee.finalSettlement.status === "POSTED" ? "posted" : "reversed"}`}>
                        {employee.finalSettlement.status}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td>Net settlement</td>
                    <td>{Number(employee.finalSettlement.netAmount).toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td>Paid to date</td>
                    <td>{Number(employee.finalSettlement.paidAmount).toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Pending</strong>
                    </td>
                    <td>
                      <strong>{pendingAmount}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>

              {employee.finalSettlement.status === "POSTED" && Number(pendingAmount) > 0 && (
                <form onSubmit={recordPayment}>
                  <div className="form-row" style={{ marginTop: 10 }}>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="Amount"
                      value={paymentForm.amount}
                      onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                      required
                      style={{ width: 110 }}
                    />
                    <select
                      value={paymentForm.bankCashAccountId}
                      onChange={(e) => setPaymentForm({ ...paymentForm, bankCashAccountId: e.target.value })}
                      required
                    >
                      <option value="" disabled>
                        Pay from…
                      </option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} — {a.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="date"
                      value={paymentForm.paymentDate}
                      onChange={(e) => setPaymentForm({ ...paymentForm, paymentDate: e.target.value })}
                      required
                    />
                    <button type="submit">Record payment</button>
                  </div>
                </form>
              )}

              {employee.finalSettlement.payments.length > 0 && (
                <table style={{ marginTop: 10 }}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Amount</th>
                      <th>Memo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employee.finalSettlement.payments.map((p) => (
                      <tr key={p.id}>
                        <td>{new Date(p.paymentDate).toLocaleDateString()}</td>
                        <td>{Number(p.amount).toFixed(2)}</td>
                        <td>{p.memo ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {employee.finalSettlement.status === "POSTED" && employee.finalSettlement.payments.length === 0 && (
                <button className="secondary" onClick={reverseSettlement} style={{ marginTop: 10 }}>
                  Reverse settlement
                </button>
              )}
            </>
          )}
          {active ? (
            <>
              {employee.finalSettlement?.status === "REVERSED" && (
                <p style={{ marginTop: 16, fontWeight: 600 }}>Release this employee again:</p>
              )}
              <div className="form-row" style={{ marginTop: employee.finalSettlement ? 0 : undefined }}>
                <select value={termForm.reason} onChange={(e) => setTermForm({ ...termForm, reason: e.target.value })}>
                  <option value="RESIGNATION">Resignation (Art. 85 reduction)</option>
                  <option value="TERMINATION_BY_EMPLOYER">Termination by employer (full EOSB)</option>
                  <option value="CONTRACT_END">Contract end (full EOSB)</option>
                </select>
                <div>
                  <label>Last working day </label>
                  <input type="date" value={termForm.lastWorkingDay} onChange={(e) => setTermForm({ ...termForm, lastWorkingDay: e.target.value })} />
                </div>
                <button className="secondary" onClick={previewSettlement} type="button">
                  Preview settlement
                </button>
              </div>
              {preview && (
                <div style={{ marginTop: 10 }}>
                  <table>
                    <tbody>
                      <tr>
                        <td>Service years</td>
                        <td>{Number(preview.serviceYears).toFixed(2)}</td>
                      </tr>
                      <tr>
                        <td>Final salary ({preview.finalSalaryDays} days)</td>
                        <td>{Number(preview.finalSalaryAmount).toFixed(2)}</td>
                      </tr>
                      <tr>
                        <td>End-of-service benefit</td>
                        <td>{Number(preview.eosbAmount).toFixed(2)}</td>
                      </tr>
                      <tr>
                        <td>Leave payout ({Number(preview.leaveBalanceDays).toFixed(2)} days)</td>
                        <td>{Number(preview.leavePayoutAmount).toFixed(2)}</td>
                      </tr>
                      <tr>
                        <td>Loan recovery</td>
                        <td>-{Number(preview.loanRecovery).toFixed(2)}</td>
                      </tr>
                      <tr>
                        <td>
                          <strong>Net settlement</strong>
                        </td>
                        <td>
                          <strong>{Number(preview.netAmount).toFixed(2)}</strong>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <button onClick={postSettlement} style={{ marginTop: 8 }}>
                    Post settlement &amp; terminate
                  </button>
                </div>
              )}
            </>
          ) : !employee.finalSettlement ? (
            <p>Terminated on {employee.terminationDate ? new Date(employee.terminationDate).toLocaleDateString() : "—"}.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
