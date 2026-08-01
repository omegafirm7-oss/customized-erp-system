import { useEffect, useRef, useState } from "react";

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

/**
 * Attach control with an explicit choice between picking an existing file
 * and capturing a new photo — two separate hidden file inputs (only the
 * camera one carries `capture="environment"`) so mobile browsers don't
 * collapse the choice down to just one behavior.
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
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

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
            minWidth: 170,
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
    </span>
  );
}
