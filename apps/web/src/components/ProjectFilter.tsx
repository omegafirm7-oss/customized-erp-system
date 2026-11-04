import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiClient } from "../api/client";

interface ProjectOption {
  id: string;
  code: string;
  name: string;
}

/**
 * Project picker shared by the financial statements. "Whole company" (empty id) is the default;
 * picking a project limits the statement to journal entries posted to that project's cost center.
 * The chosen project rides in the URL (?projectId=) so drill-downs and the back links keep it.
 */
export function useProjectFilter() {
  const [searchParams] = useSearchParams();
  const [projectId, setProjectId] = useState(searchParams.get("projectId") ?? "");
  const [projects, setProjects] = useState<ProjectOption[]>([]);

  useEffect(() => {
    // Users without project access simply don't get the picker.
    apiClient.get<ProjectOption[]>("/projects").then((res) => setProjects(res.data)).catch(() => setProjects([]));
  }, []);

  const project = projects.find((p) => p.id === projectId);
  const projectQuery = projectId ? `&projectId=${projectId}` : "";
  const picker =
    projects.length > 0 ? (
      <>
        <label>Project </label>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">Whole company</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} — {p.name}
            </option>
          ))}
        </select>
      </>
    ) : null;

  return { projectId, projectQuery, picker, project };
}

/** Explains what a single-project view of a statement does and doesn't contain. */
export function ProjectScopeNote({ project, children }: { project?: { code: string; name: string }; children: React.ReactNode }) {
  if (!project) return null;
  return (
    <div style={{ background: "#fffaeb", border: "1px solid #fedf89", borderRadius: 6, padding: "8px 12px", margin: "8px 0", fontSize: 13 }}>
      Showing only entries posted to <strong>{project.code} — {project.name}</strong>. {children}
    </div>
  );
}
