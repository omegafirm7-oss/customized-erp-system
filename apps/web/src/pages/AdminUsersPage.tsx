import { useCallback, useEffect, useState } from "react";
import { apiClient } from "../api/client";

interface CompanyUserRow {
  userId: string;
  email: string;
  fullName: string;
  isActive: boolean;
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

  const [joinRequests, setJoinRequests] = useState<JoinRequestRow[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [approveOpenId, setApproveOpenId] = useState<string | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [joinRequestError, setJoinRequestError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<CompanyUserRow[]>("/iam/company-users");
      setUsers(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadJoinRequests = useCallback(async () => {
    const [requestsRes, rolesRes] = await Promise.all([
      apiClient.get<JoinRequestRow[]>("/iam/join-requests"),
      apiClient.get<RoleOption[]>("/iam/roles"),
    ]);
    setJoinRequests(requestsRes.data);
    setRoles(rolesRes.data);
  }, []);

  useEffect(() => {
    load();
    loadJoinRequests();
  }, [load, loadJoinRequests]);

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
      await Promise.all([load(), loadJoinRequests()]);
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
        <h2>Users</h2>
        <p style={{ color: "#667085", fontSize: 13 }}>
          Reset a user's password here (admin-set — no email is sent). Share the new password with them directly; any
          of their active sessions are signed out once it's changed.
        </p>
        {error && <div className="error-banner">{error}</div>}
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
                    <td>{u.roleName}</td>
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
