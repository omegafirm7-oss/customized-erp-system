import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../api/client";

interface JournalEntryLine {
  id: string;
  accountId: string;
  account: { code: string; name: string };
  debit: string;
  credit: string;
  description: string | null;
}

interface JournalEntry {
  id: string;
  entryNumber: string | null;
  postingDate: string;
  status: "DRAFT" | "POSTED" | "REVERSED";
  memo: string | null;
  lines: JournalEntryLine[];
}

export function JournalEntriesPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    return apiClient
      .get<JournalEntry[]>("/gl/journal-entries")
      .then((res) => setEntries(res.data))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handlePost(id: string) {
    setError(null);
    setBusyId(id);
    try {
      await apiClient.post(`/gl/journal-entries/${id}/post`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to post entry");
    } finally {
      setBusyId(null);
    }
  }

  async function handleReverse(id: string) {
    setError(null);
    setBusyId(id);
    try {
      await apiClient.post(`/gl/journal-entries/${id}/reverse`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to reverse entry");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Journal Entries</h2>
        <Link to="/journal-entries/new">
          <button>New journal entry</button>
        </Link>
      </div>
      {error && <div className="error-banner">{error}</div>}
      {loading ? (
        <p>Loading…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Number</th>
              <th>Date</th>
              <th>Memo</th>
              <th>Status</th>
              <th>Lines</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.entryNumber ?? "—"}</td>
                <td>{new Date(entry.postingDate).toLocaleDateString()}</td>
                <td>{entry.memo}</td>
                <td>
                  <span className={`badge ${entry.status.toLowerCase()}`}>{entry.status}</span>
                </td>
                <td>
                  {entry.lines.map((l) => (
                    <div key={l.id}>
                      {l.account.code} — D {l.debit} / C {l.credit}
                    </div>
                  ))}
                </td>
                <td>
                  {entry.status === "DRAFT" && (
                    <button disabled={busyId === entry.id} onClick={() => handlePost(entry.id)}>
                      Post
                    </button>
                  )}
                  {entry.status === "POSTED" && (
                    <button className="secondary" disabled={busyId === entry.id} onClick={() => handleReverse(entry.id)}>
                      Reverse
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
