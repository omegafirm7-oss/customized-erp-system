import { useEffect, useState } from "react";
import { apiClient } from "../api/client";

interface Breakdown {
  vatCategory: string;
  netAmount: string;
  vatAmount: string;
}

interface VatReturnReport {
  fromDate: string;
  toDate: string;
  salesByCategory: Breakdown[];
  purchasesByCategory: Breakdown[];
  outputVat: string;
  inputVat: string;
  netVatPayable: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  STANDARD_15: "Standard-rated (15%)",
  ZERO_RATED: "Zero-rated (0%)",
  EXEMPT: "Exempt",
};

function firstOfMonth(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

export function VatReturnPage() {
  const [fromDate, setFromDate] = useState(firstOfMonth());
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<VatReturnReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiClient
      .get<VatReturnReport>("/reports/vat-return", { params: { fromDate, toDate } })
      .then((res) => setReport(res.data))
      .finally(() => setLoading(false));
  }, [fromDate, toDate]);

  return (
    <div className="card">
      <div className="form-row" style={{ justifyContent: "space-between" }}>
        <h2>VAT Return Summary</h2>
        <div>
          <label>From </label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <label> To </label>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
      </div>
      {loading || !report ? (
        <p>Loading…</p>
      ) : (
        <>
          <h3>Sales (Output VAT)</h3>
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Net Sales</th>
                <th>VAT</th>
              </tr>
            </thead>
            <tbody>
              {report.salesByCategory.map((row) => (
                <tr key={row.vatCategory}>
                  <td>{CATEGORY_LABELS[row.vatCategory] ?? row.vatCategory}</td>
                  <td>{row.netAmount}</td>
                  <td>{row.vatAmount}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Purchases (Input VAT)</h3>
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Net Purchases</th>
                <th>VAT</th>
              </tr>
            </thead>
            <tbody>
              {report.purchasesByCategory.map((row) => (
                <tr key={row.vatCategory}>
                  <td>{CATEGORY_LABELS[row.vatCategory] ?? row.vatCategory}</td>
                  <td>{row.netAmount}</td>
                  <td>{row.vatAmount}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="card" style={{ marginTop: 16, background: "#f8f9fb" }}>
            <p>
              Output VAT: <strong>{report.outputVat}</strong>
            </p>
            <p>
              Input VAT (deductible): <strong>{report.inputVat}</strong>
            </p>
            <p>
              Net VAT {Number(report.netVatPayable) >= 0 ? "payable" : "refundable"}:{" "}
              <strong>{report.netVatPayable}</strong>
            </p>
          </div>
        </>
      )}
    </div>
  );
}
