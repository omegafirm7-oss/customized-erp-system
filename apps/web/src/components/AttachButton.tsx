import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { apiClient } from "../api/client";

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;

/**
 * Phone camera photos routinely come in at 3-8MB (or more) at full sensor
 * resolution — every later View has to download that in full before it can
 * even start rendering. Downscaling to a sane on-screen size and re-encoding
 * as JPEG client-side, before upload, cuts that by an order of magnitude
 * with no visible quality loss for viewing evidence photos.
 */
async function compressImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unsupported");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  if (!blob || blob.size >= file.size) return file;

  const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], newName, { type: "image/jpeg" });
}

const POLL_INTERVAL_MS = 2000;

/**
 * Attach control with an explicit choice between picking an existing file,
 * capturing a new photo on this device, and pulling a photo in from a phone
 * — three separate hidden/virtual capture paths so mobile browsers don't
 * collapse the choice down to just one behavior, and so a desktop user
 * (whose PC has no usable camera) isn't stuck with Windows' own slow
 * cross-device camera-pairing flow for "Take photo".
 *
 * "Use phone camera" shows a QR code encoding a short-lived, single-use
 * link (`PhotoUploadMobilePage`) — the phone opens it with no login,
 * takes a photo with its own camera (instant, since it's the phone's own
 * OS handling capture, not a continuity feature), and posts it back. This
 * component polls the same session and pulls the photo in the moment it
 * lands, then runs it through the same compress+attach path as any other
 * file.
 */
export function AttachButton({
  uploading,
  onFile,
  label = "Attach",
}: {
  uploading: boolean;
  onFile: (file: File) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  useEffect(() => stopPolling, []);

  function stopPolling() {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function pick(file: File | undefined) {
    setOpen(false);
    if (!file) return;
    if (file.type.startsWith("image/") && file.type !== "image/gif") {
      try {
        file = await compressImage(file);
      } catch {
        // fall through and upload the original if compression fails for any reason
      }
    }
    onFile(file);
  }

  async function startPhoneCamera() {
    setOpen(false);
    setQrError(null);
    setQrDataUrl(null);
    try {
      const res = await apiClient.post<{ token: string; expiresAt: string }>("/photo-upload-sessions");
      const token = res.data.token;
      const url = `${window.location.origin}/mobile-upload/${token}`;
      const dataUrl = await QRCode.toDataURL(url, { width: 220, margin: 1 });
      setQrDataUrl(dataUrl);
      // The whole point of this flow is stepping away from the desktop to
      // use the phone — that must not read as idle abandonment (see
      // IdleTimeoutGuard's SYNTHETIC_ACTIVITY_EVENT) or the session (and
      // whatever the user was filling in) gets logged out from under them
      // mid-wait, before they ever get a chance to save.
      window.dispatchEvent(new Event("app:activity"));
      pollRef.current = window.setInterval(() => checkSession(token), POLL_INTERVAL_MS);
    } catch {
      setQrError("Couldn't start — try again");
    }
  }

  async function checkSession(token: string) {
    window.dispatchEvent(new Event("app:activity"));
    try {
      const res = await apiClient.get<{ status: "PENDING" | "UPLOADED" }>(`/photo-upload-sessions/${token}/status`);
      if (res.data.status === "UPLOADED") {
        stopPolling();
        const fileRes = await apiClient.get(`/photo-upload-sessions/${token}/file`, { responseType: "blob" });
        const mimeType = (fileRes.headers["content-type"] as string) ?? "image/jpeg";
        const file = new File([fileRes.data], "phone-photo.jpg", { type: mimeType });
        setQrDataUrl(null);
        pick(file);
      }
    } catch (err: any) {
      if (err?.response?.status === 410) {
        stopPolling();
        setQrError("That link expired before your phone used it — try again");
      }
      // transient network hiccups: just try again on the next tick
    }
  }

  function closeQr() {
    stopPolling();
    setQrDataUrl(null);
    setQrError(null);
  }

  if (uploading) {
    return <span style={{ fontSize: 12, color: "#667085" }}>Uploading…</span>;
  }

  return (
    <span ref={wrapperRef} style={{ position: "relative", display: "inline-block" }}>
      <button type="button" className="secondary" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => setOpen((o) => !o)}>
        {label}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            zIndex: 20,
            background: "#fff",
            border: "1px solid #d0d5dd",
            borderRadius: 6,
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            minWidth: 190,
            marginTop: 2,
            overflow: "hidden",
          }}
        >
          <button
            type="button"
            className="secondary"
            style={{ display: "block", width: "100%", textAlign: "left", border: "none", borderRadius: 0, padding: "8px 10px" }}
            onClick={() => fileInputRef.current?.click()}
          >
            📁 Upload from files
          </button>
          <button
            type="button"
            className="secondary"
            style={{ display: "block", width: "100%", textAlign: "left", border: "none", borderRadius: 0, padding: "8px 10px" }}
            onClick={() => cameraInputRef.current?.click()}
          >
            📷 Take photo
          </button>
          <button
            type="button"
            className="secondary"
            style={{ display: "block", width: "100%", textAlign: "left", border: "none", borderRadius: 0, padding: "8px 10px" }}
            onClick={startPhoneCamera}
          >
            📱 Use phone camera
          </button>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          pick(file);
          e.target.value = "";
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          pick(file);
          e.target.value = "";
        }}
      />
      {(qrDataUrl || qrError) && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={closeQr}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: 24,
              maxWidth: 300,
              textAlign: "center",
              boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700, color: "#101828" }}>Scan with your phone</h3>
            {qrError ? (
              <p style={{ color: "#d92d20", fontSize: 13, marginBottom: 16 }}>{qrError}</p>
            ) : (
              <>
                {qrDataUrl && <img src={qrDataUrl} alt="QR code to open camera on your phone" style={{ width: 220, height: 220 }} />}
                <p style={{ fontSize: 12.5, color: "#667085", marginTop: 12, marginBottom: 16 }}>
                  Open your phone's camera app or scan this with any QR scanner. Take the photo — it'll appear here
                  automatically.
                </p>
              </>
            )}
            <button
              type="button"
              className="secondary"
              onClick={qrError ? startPhoneCamera : closeQr}
              style={{ padding: "6px 16px" }}
            >
              {qrError ? "Try again" : "Cancel"}
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
