import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";

type Phase = "checking" | "ready" | "uploading" | "done" | "expired";

/**
 * The page a phone lands on after scanning the QR code from a desktop's
 * "Use phone camera" button. Deliberately outside the app's login/company
 * shell — the phone never needs to authenticate, it just takes a photo
 * with its own camera and posts it back to the session the desktop is
 * watching. No navigation, no other app features reachable from here.
 */
export function PhotoUploadMobilePage() {
  const { token } = useParams<{ token: string }>();
  const [phase, setPhase] = useState<Phase>("checking");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!token) return;
    axios
      .get(`/api/photo-upload-sessions/${token}/status`)
      .then((res) => setPhase(res.data.status === "UPLOADED" ? "done" : "ready"))
      .catch(() => setPhase("expired"));
  }, [token]);

  async function handleFile(file: File | undefined) {
    if (!file || !token) return;
    setError(null);
    setPhase("uploading");
    try {
      const form = new FormData();
      form.append("file", file);
      await axios.post(`/api/photo-upload-sessions/${token}/upload`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setPhase("done");
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Upload failed — try again");
      setPhase("ready");
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
        fontFamily: "system-ui, -apple-system, sans-serif",
        background: "#101828",
        color: "#fff",
      }}
    >
      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Universa Centrix</h1>

      {phase === "checking" && <p style={{ color: "#98a2b3" }}>Checking link…</p>}

      {phase === "expired" && (
        <p style={{ color: "#98a2b3", maxWidth: 280 }}>
          This upload link is invalid or has expired. Go back to your PC and click "Use phone camera" again to get a
          fresh link.
        </p>
      )}

      {phase === "ready" && (
        <>
          <p style={{ color: "#98a2b3", maxWidth: 280, marginBottom: 20 }}>
            Take a photo of the receipt or document — it'll be sent straight to your PC.
          </p>
          {error && <p style={{ color: "#f97066", marginBottom: 12 }}>{error}</p>}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            style={{
              background: "#2a78d6",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              padding: "16px 28px",
              fontSize: 16,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            📷 Take Photo
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </>
      )}

      {phase === "uploading" && <p style={{ color: "#98a2b3" }}>Sending photo to your PC…</p>}

      {phase === "done" && (
        <p style={{ color: "#12b76a", fontSize: 16, fontWeight: 600, maxWidth: 280 }}>
          ✓ Sent — check your PC. You can close this page now.
        </p>
      )}
    </div>
  );
}
