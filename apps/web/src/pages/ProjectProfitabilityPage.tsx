import { useEffect, useState } from "react";
import { apiClient } from "../api/client";

interface TaskRow {
  taskId: string;
  code: string;
  name: string;
  parentTaskId: string | null;
  costBudget: string;
  actualCost: string;
  variance: string;
}

interface ProfitRow {
  projectId: string;
  code: string;
  name: string;
  status: string;
  recognitionMethod: string;
  contractValue: string;
  billedToDate: string;
  revenueRecognized: string;
  costsToDate: string;
  estimatedTotalCost: string;
  percentComplete: string;
  margin: string;
  tasks: TaskRow[];
}

export function ProjectProfitabilityPage() {
  const [rows, setRows] = useState<ProfitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<ProfitRow[]>("/reports/project-profitability")
      .then((res) => setRows(res.data))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="card">
      <h2>Project Profitability</h2>
      {loading ? (
        <p>Loading…</p>
      ) : rows.length === 0 ? (
        <p>No projects.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Project</th>
              <th>Status</th>
              <th>Contract</th>
              <th>Billed</th>
              <th>Recognized</th>
              <th>Costs</th>
              <th>POC %</th>
              <th>Margin</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <>
                <tr key={row.projectId}>
                  <td>
                    {row.code} — {row.name}
                  </td>
                  <td>{row.status}</td>
                  <td>{row.contractValue}</td>
                  <td>{row.billedToDate}</td>
                  <td>{row.revenueRecognized}</td>
                  <td>{row.costsToDate}</td>
                  <td>{row.percentComplete}%</td>
                  <td style={{ color: Number(row.margin) < 0 ? "#912018" : "#027a48" }}>{row.margin}</td>
                  <td>
                    {row.tasks.length > 0 && (
                      <button className="secondary" onClick={() => setExpanded(expanded === row.projectId ? null : row.projectId)}>
                        {expanded === row.projectId ? "Hide tasks" : "Tasks"}
                      </button>
                    )}
                  </td>
                </tr>
                {expanded === row.projectId &&
                  row.tasks.map((task) => (
                    <tr key={task.taskId} style={{ background: "#f8f9fb" }}>
                      <td style={{ paddingLeft: 32 }}>
                        {task.code} — {task.name}
                      </td>
                      <td colSpan={2}></td>
                      <td>Budget: {task.costBudget}</td>
                      <td>Actual: {task.actualCost}</td>
                      <td colSpan={2} style={{ color: Number(task.variance) < 0 ? "#912018" : "#027a48" }}>
                        Variance: {task.variance}
                      </td>
                      <td colSpan={2}></td>
                    </tr>
                  ))}
              </>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
