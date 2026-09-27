import { useEffect, useState } from "react";
import { apiClient } from "../../api/client";

export interface Flyer {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
}

const MAX_EMAIL_IMAGE_WIDTH = 1200;

/**
 * Email clients are picky: Outlook desktop can't show WebP/HEIC at all, and
 * huge images bloat every send. Anything that isn't already a modest JPEG/PNG
 * is re-encoded as JPEG and capped at 1200px wide before upload.
 */
export async function prepareFlyer(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  const bitmap = await createImageBitmap(file);
  const tooWide = bitmap.width > MAX_EMAIL_IMAGE_WIDTH;
  if (!tooWide && (file.type === "image/jpeg" || file.type === "image/png")) {
    bitmap.close();
    return file;
  }
  const scale = Math.min(1, MAX_EMAIL_IMAGE_WIDTH / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser can't convert this image — please upload a JPEG or PNG");
  ctx.fillStyle = "#fff"; // JPEG has no transparency
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
  if (!blob) throw new Error("Could not convert this image — please upload a JPEG or PNG");
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
}

export function useFlyers() {
  const [flyers, setFlyers] = useState<Flyer[]>([]);
  const reload = () =>
    apiClient
      .get<Flyer[]>("/crm/agent/assets")
      .then((res) => setFlyers(res.data))
      .catch(() => setFlyers([]));
  useEffect(() => {
    reload();
  }, []);
  return { flyers, reload };
}

/** Downloads a flyer as a File (for the phone share sheet / clipboard). */
export async function fetchFlyerFile(flyer: Flyer): Promise<File> {
  const res = await apiClient.get<Blob>(`/crm/agent/assets/${flyer.id}/file`, { responseType: "blob" });
  return new File([res.data], flyer.fileName, { type: flyer.mimeType });
}

/**
 * Puts a flyer image on the clipboard so it can be pasted (Ctrl+V) into a
 * WhatsApp Web chat. Browsers only accept PNG images on the clipboard, so
 * JPEGs are re-encoded; the Blob is passed as a promise so the write still
 * counts as part of the click.
 */
export async function copyFlyerToClipboard(file: File): Promise<void> {
  const toPng = async (): Promise<Blob> => {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Could not prepare the image");
    return blob;
  };
  if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
    throw new Error("This browser can't copy images — save the flyer and attach it in WhatsApp instead");
  }
  await navigator.clipboard.write([new ClipboardItem({ "image/png": toPng() })]);
}

/** Phones/tablets, where the share sheet can hand files straight to WhatsApp. */
export function isTouchDevice(): boolean {
  const ua = navigator.userAgent;
  return /Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Thumbnail loaded with the auth header (a plain <img src> can't send it). */
export function FlyerThumb({ flyer }: { flyer: Flyer }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!flyer.mimeType.startsWith("image/")) return;
    let objectUrl: string | null = null;
    apiClient
      .get(`/crm/agent/assets/${flyer.id}/file`, { responseType: "blob" })
      .then((res) => {
        objectUrl = URL.createObjectURL(res.data);
        setUrl(objectUrl);
      })
      .catch(() => setUrl(null));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [flyer.id, flyer.mimeType]);
  if (!flyer.mimeType.startsWith("image/")) return <div className="flyer-thumb flyer-pdf">PDF</div>;
  return url ? <img className="flyer-thumb" src={url} alt={flyer.fileName} /> : <div className="flyer-thumb" />;
}

/** Upload/delete the company's email flyers (Outreach page). */
export function FlyerLibrary() {
  const { flyers, reload } = useFlyers();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const original of Array.from(files)) {
        const file = await prepareFlyer(original);
        const form = new FormData();
        form.append("file", file);
        await apiClient.post("/crm/agent/assets", form);
      }
    } catch (err: any) {
      setError(err?.response?.data?.message ?? err?.message ?? "Upload failed");
    } finally {
      setBusy(false);
      reload();
    }
  }

  async function remove(f: Flyer) {
    if (!window.confirm(`Delete "${f.fileName}"?`)) return;
    setError(null);
    try {
      await apiClient.delete(`/crm/agent/assets/${f.id}`);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Delete failed");
    } finally {
      reload();
    }
  }

  return (
    <div className="card">
      <h3>Email flyers</h3>
      <p className="outreach-hint">
        Upload your offer flyers once, then tick them when you email a lead. Images appear inside the email under your message; PDFs go as attachments.
        WebP and large images are converted to JPEG automatically so they show in Outlook.
      </p>
      {error && <div className="error-banner">{error}</div>}
      {flyers.length > 0 && (
        <div className="flyer-grid">
          {flyers.map((f) => (
            <div key={f.id} className="flyer-card">
              <FlyerThumb flyer={f} />
              <div className="flyer-name" title={f.fileName}>
                {f.fileName}
              </div>
              <div className="lead-sub">{Math.round(f.size / 1024)} KB</div>
              <button type="button" className="danger" onClick={() => remove(f)}>
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
      <label className="flyer-upload">
        <input
          type="file"
          accept="image/*,application/pdf"
          multiple
          disabled={busy}
          onChange={(e) => {
            upload(e.target.files);
            e.target.value = "";
          }}
        />
        <span>{busy ? "Uploading…" : "Upload flyers"}</span>
      </label>
    </div>
  );
}
