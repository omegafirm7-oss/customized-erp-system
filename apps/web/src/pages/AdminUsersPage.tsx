import { useCallback, useEffect, useMemo, useState } from "react";
import { apiClient } from "../api/client";

interface CompanyUserRow {
  companyUserId: string;
  userId: string;
  email: string;
  fullName: string;
  isActive: boolean;
  roleId: string;
  roleName: string;
  status: string;
}

interface JoinRequestRow {
  id: string;
  userId: string;
  email: string;
  fullName: string;
  message: string | null;
  requestedAt: string;
}

interface RoleOption {
  id: string;
  name: string;
  isSystem: boolean;
  permissionKeys: string[];
  userCount: number;
}

interface PermissionEntry {
  key: string;
  module: string;
}

const MODULE_LABELS: Record<string, string> = {
  iam: "Users & Roles",
  companies: "Company Settings",
  gl: "General Ledger",
  coa: "Chart of Accounts",
  partners: "Partners",
  items: "Items",
  reports: "Reports",
  ar: "Sales Invoices (AR)",
  ap: "Purchase Invoices (AP)",
  payments: "Payments",
  zatca: "ZATCA e-Invoicing",
  inventory: "Inventory",
  projects: "Projects",
  hr: "Employees & Payroll",
  manpower: "Manpower",
  equipment: "Equipment",
};

function moduleLabel(module: string): string {
  return MODULE_LABELS[module] ?? module.charAt(0).toUpperCase() + module.slice(1);
}

function permissionLabel(key: string): string {
  const parts = key.split(".");
  const action = parts[parts.length - 1];
  const entity = parts.length > 2 ? parts[1] : "";
  const actionLabel = action.charAt(0).toUpperCase() + action.slice(1);
  const entityLabel = entity ? entity.charAt(0).toUpperCase() + entity.slice(1).replace(/_/g, " ") : "";
  return entityLabel ? `${entityLabel} — ${actionLabel}` : actionLabel;
}

function randomTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function AdminUsersPage() {
  const [users, setUsers] = useState<CompanyUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resetOpenId, setResetOpenId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmedFor, setConfirmedFor] = useState<{ userId: string; password: string } | null>(null);
  const [roleChangeError, setRoleChangeError] = useState<string | null>(null);

  const [joinRequests, setJoinRequests] = useState<JoinRequestRow[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [permissionCatalog, setPermissionCatalog] = useState<PermissionEntry[]>([]);
  const [approveOpenId, setApproveOpenId] = useState<string | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [joinRequestError, setJoinRequestError] = useState<string | null>(null);

  const [roleEditorId, setRoleEditorId] = useState<string | "new" | null>(null);
  const [roleFormName, setRoleFormName] = useState("");
  const [roleFormPermissions, setRoleFormPermissions] = useState<Set<string>>(new Set());
  const [roleError, setRoleError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<CompanyUserRow[]>("/iam/company-users");
      setUsers(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRoles = useCallback(async () => {
    const [rolesRes, permissionsRes] = await Promise.all([
      apiClient.get<RoleOption[]>("/iam/roles"),
      apiClient.get<PermissionEntry[]>("/iam/permissions"),
    ]);
    setRoles(rolesRes.data);
    setPermissionCatalog(permissionsRes.data);
  }, []);

  const loadJoinRequests = useCallback(async () => {
    const res = await apiClient.get<JoinRequestRow[]>("/iam/join-requests");
    setJoinRequests(res.data);
  }, []);

  useEffect(() => {
    load();
    loadRoles();
    loadJoinRequests();
  }, [load, loadRoles, loadJoinRequests]);

  const permissionsByModule = useMemo(() => {
    const groups = new Map<string, PermissionEntry[]>();
    for (const p of permissionCatalog) {
      if (!groups.has(p.module)) groups.set(p.module, []);
      groups.get(p.module)!.push(p);
    }
    return [...groups.entries()].sort((a, b) => moduleLabel(a[0]).localeCompare(moduleLabel(b[0])));
  }, [permissionCatalog]);

  function openApprove(requestId: string) {
    setApproveOpenId(requestId);
    setSelectedRoleId(roles[0]?.id ?? "");
    setJoinRequestError(null);
  }

  async function approveJoinRequest(requestId: string) {
    setJoinRequestError(null);
    try {
      await apiClient.post(`/iam/join-requests/${requestId}/approve`, { roleId: selectedRoleId });
      setApproveOpenId(null);
      await Promise.all([load(), loadJoinRequests(), loadRoles()]);
    } catch (err: any) {
      setJoinRequestError(err?.response?.data?.message ?? "Failed to approve request");
    }
  }

  async function rejectJoinRequest(requestId: string) {
    setJoinRequestError(null);
    try {
      await apiClient.post(`/iam/join-requests/${requestId}/reject`, {});
      await loadJoinRequests();
    } catch (err: any) {
      setJoinRequestError(err?.response?.data?.message ?? "Failed to reject request");
    }
  }

  function openReset(userId: string) {
    setResetOpenId(userId);
    setNewPassword(randomTempPassword());
    setConfirmedFor(null);
    setError(null);
  }

  async function resetPassword(userId: string) {
    setError(null);
    try {
      await apiClient.patch(`/iam/users/${userId}/reset-password`, { newPassword });
      setConfirmedFor({ userId, password: newPassword });
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to reset password");
    }
  }

  async function changeUserRole(companyUserId: string, roleId: string) {
    setRoleChangeError(null);
    try {
      await apiClient.patch(`/iam/company-users/${companyUserId}/role`, { roleId });
      await load();
    } catch (err: any) {
      setRoleChangeError(err?.response?.data?.message ?? "Failed to change role");
    }
  }

  function openNewRole() {
    setRoleEditorId("new");
    setRoleFormName("");
    setRoleFormPermissions(new Set());
    setRoleError(null);
  }

  function openEditRole(role: RoleOption) {
    setRoleEditorId(role.id);
    setRoleFormName(role.name);
    setRoleFormPermissions(new Set(role.permissionKeys));
    setRoleError(null);
  }

  function closeRoleEditor() {
    setRoleEditorId(null);
  }

  function togglePermission(key: string) {
    setRoleFormPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleModule(keys: string[], allChecked: boolean) {
    setRoleFormPermissions((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (allChecked) next.delete(key);
        else next.add(key);
      }
      return next;
    });
  }

  async function saveRole() {
    setRoleError(null);
    const permissionKeys = [...roleFormPermissions];
    try {
      if (roleEditorId === "new") {
        await apiClient.post("/iam/roles", { name: roleFormName, permissionKeys });
      } else if (roleEditorId) {
        await apiClient.patch(`/iam/roles/${roleEditorId}`, { name: roleFormName, permissionKeys });
      }
      setRoleEditorId(null);
      await loadRoles();
    } catch (err: any) {
      setRoleError(err?.response?.data?.message ?? "Failed to save role");
    }
  }

  async function deleteRole(role: RoleOption) {
    if (!window.confirm(`Delete role "${role.name}"? This cannot be undone.`)) return;
    setRoleError(null);
    try {
      await apiClient.delete(`/iam/roles/${role.id}`);
      await loadRoles();
    } catch (err: any) {
      setRoleError(err?.response?.data?.message ?? "Failed to delete role");
    }
  }

  return (
    <div>
      {joinRequests.length > 0 && (
        <div className="card">
          <h2>Pending join requests</h2>
          {joinRequestError && <div className="error-banner">{joinRequestError}</div>}
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Message</th>
                <th>Requested</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {joinRequests.map((r) => (
                <>
                  <tr key={r.id}>
                    <td>{r.fullName}</td>
                    <td>{r.email}</td>
                    <td>{r.message ?? "—"}</td>
                    <td>{new Date(r.requestedAt).toLocaleDateString()}</td>
                    <td>
                      <button className="secondary" onClick={() => (approveOpenId === r.id ? setApproveOpenId(null) : openApprove(r.id))}>
                        {approveOpenId === r.id ? "Cancel" : "Review"}
                      </button>
                    </td>
                  </tr>
                  {approveOpenId === r.id && (
                    <tr>
                      <td colSpan={5}>
                        <div className="form-row" style={{ margin: "6px 0" }}>
                          <select value={selectedRoleId} onChange={(e) => setSelectedRoleId(e.target.value)}>
                            {roles.map((role) => (
                              <option key={role.id} value={role.id}>
                                {role.name}
                              </option>
                            ))}
                          </select>
                          <button onClick={() => approveJoinRequest(r.id)} disabled={!selectedRoleId}>
                            Approve
                          </button>
                          <button className="secondary" onClick={() => rejectJoinRequest(r.id)}>
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2>Roles &amp; Permissions</h2>
            <p style={{ color: "#667085", fontSize: 13, marginTop: 4 }}>
              Create custom roles to restrict a user to specific tabs — e.g. an "Employees Only" role that can only
              view/edit the Employees module. Assign a role to a user below in the Users table. System roles
              (Administrator/Accountant/Viewer) can't be edited or deleted.
            </p>
          </div>
          {roleEditorId === null && (
            <button className="secondary" onClick={openNewRole}>
              + New role
            </button>
          )}
        </div>
        {roleError && <div className="error-banner">{roleError}</div>}

        {roleEditorId !== null ? (
          <div style={{ marginTop: 12 }}>
            <div className="form-row" style={{ marginBottom: 12 }}>
              <input
                placeholder="Role name (e.g. Employees Only)"
                value={roleFormName}
                onChange={(e) => setRoleFormName(e.target.value)}
                style={{ width: 280 }}
              />
              <button onClick={saveRole} disabled={roleFormName.trim().length < 2}>
                Save role
              </button>
              <button className="secondary" onClick={closeRoleEditor}>
                Cancel
              </button>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                gap: 12,
                maxHeight: 420,
                overflowY: "auto",
                border: "1px solid #eaecf0",
                borderRadius: 8,
                padding: 12,
              }}
            >
              {permissionsByModule.map(([module, perms]) => {
                const keys = perms.map((p) => p.key);
                const allChecked = keys.every((k) => roleFormPermissions.has(k));
                return (
                  <div key={module}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, marginBottom: 4 }}>
                      <input type="checkbox" checked={allChecked} onChange={() => toggleModule(keys, allChecked)} />
                      {moduleLabel(module)}
                    </label>
                    {perms.map((p) => (
                      <label key={p.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginLeft: 20 }}>
                        <input
                          type="checkbox"
                          checked={roleFormPermissions.has(p.key)}
                          onChange={() => togglePermission(p.key)}
                        />
                        {permissionLabel(p.key)}
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Permissions</th>
                <th>Users</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role.id}>
                  <td>{role.name}</td>
                  <td>
                    <span className={`badge ${role.isSystem ? "draft" : "posted"}`}>{role.isSystem ? "System" : "Custom"}</span>
                  </td>
                  <td>{role.permissionKeys.length}</td>
                  <td>{role.userCount}</td>
                  <td>
                    {!role.isSystem && (
                      <>
                        <button className="secondary" onClick={() => openEditRole(role)}>
                          Edit
                        </button>{" "}
                        <button className="danger" onClick={() => deleteRole(role)} disabled={role.userCount > 0}>
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Users</h2>
        <p style={{ color: "#667085", fontSize: 13 }}>
          Change a user's role to control which tabs they can see and edit, or reset their password (admin-set — no
          email is sent). Share the new password with them directly; any of their active sessions are signed out once
          it's changed.
        </p>
        {error && <div className="error-banner">{error}</div>}
        {roleChangeError && <div className="error-banner">{roleChangeError}</div>}
      </div>

      <div className="card">
        {loading ? (
          <p>Loading…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <>
                  <tr key={u.userId}>
                    <td>{u.fullName}</td>
                    <td>{u.email}</td>
                    <td>
                      <select value={u.roleId} onChange={(e) => changeUserRole(u.companyUserId, e.target.value)}>
                        {roles.map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <span className={`badge ${u.status === "ACTIVE" ? "posted" : "draft"}`}>{u.status}</span>
                    </td>
                    <td>
                      <button className="secondary" onClick={() => (resetOpenId === u.userId ? setResetOpenId(null) : openReset(u.userId))}>
                        {resetOpenId === u.userId ? "Cancel" : "Reset password"}
                      </button>
                    </td>
                  </tr>
                  {resetOpenId === u.userId && (
                    <tr>
                      <td colSpan={5}>
                        {confirmedFor?.userId === u.userId ? (
                          <div style={{ margin: "6px 0" }}>
                            <p style={{ color: "#027a48", marginBottom: 4 }}>
                              Password reset for {u.fullName}. Share this with them now — it will not be shown again:
                            </p>
                            <code style={{ background: "#f4f5f7", padding: "4px 8px", borderRadius: 4, fontSize: 14 }}>{confirmedFor.password}</code>
                          </div>
                        ) : (
                          <div className="form-row" style={{ margin: "6px 0" }}>
                            <input
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                              minLength={10}
                              style={{ width: 220 }}
                            />
                            <button className="secondary" type="button" onClick={() => setNewPassword(randomTempPassword())}>
                              Regenerate
                            </button>
                            <button onClick={() => resetPassword(u.userId)} disabled={newPassword.length < 10}>
                              Confirm reset
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
