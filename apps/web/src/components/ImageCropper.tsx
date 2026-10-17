import { useCallback, useEffect, useRef, useState } from "react";

type Mode = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Crop rectangle as fractions (0..1) of the displayed image, so it survives resizes and rotation. */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const FULL: Box = { x: 0, y: 0, w: 1, h: 1 };
const MIN_PX = 40;
const HANDLES: Array<{ mode: Mode; style: React.CSSProperties; cursor: string }> = [
  { mode: "nw", style: { left: -7, top: -7 }, cursor: "nwse-resize" },
  { mode: "n", style: { left: "50%", top: -7, marginLeft: -7 }, cursor: "ns-resize" },
  { mode: "ne", style: { right: -7, top: -7 }, cursor: "nesw-resize" },
  { mode: "e", style: { right: -7, top: "50%", marginTop: -7 }, cursor: "ew-resize" },
  { mode: "se", style: { right: -7, bottom: -7 }, cursor: "nwse-resize" },
  { mode: "s", style: { left: "50%", bottom: -7, marginLeft: -7 }, cursor: "ns-resize" },
  { mode: "sw", style: { left: -7, bottom: -7 }, cursor: "nesw-resize" },
  { mode: "w", style: { left: -7, top: "50%", marginTop: -7 }, cursor: "ew-resize" },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

async function rotateBlob(blob: Blob, mimeType: string): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.height;
  canvas.height = bitmap.width;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unsupported");
  ctx.translate(canvas.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const out: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, 0.95));
  if (!out) throw new Error("rotate failed");
  return out;
}

/**
 * Lets the user trim the border off a photographed receipt before it is
 * attached: drag the box (or its handles) over just the receipt, rotate a
 * sideways photo, or keep the whole image. Resolves with the cropped file,
 * or the untouched original when nothing was changed.
 */
export function ImageCropper({
  file,
  onDone,
  onCancel,
}: {
  file: File;
  onDone: (file: File) => void;
  onCancel: () => void;
}) {
  const outType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const [working, setWorking] = useState<Blob>(file);
  const [rotated, setRotated] = useState(false);
  const [url, setUrl] = useState("");
  const [box, setBox] = useState<Box>(FULL);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [busy, setBusy] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ mode: Mode; startX: number; startY: number; start: Box } | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(working);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [working]);

  const measure = useCallback(() => {
    const img = imgRef.current;
    if (img) setDims({ w: img.clientWidth, h: img.clientHeight });
  }, []);

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  function onPointerDown(e: React.PointerEvent, mode: Mode) {
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Some browsers reject capture for inactive pointers; dragging still works while the pointer stays over the box.
    }
    drag.current = { mode, startX: e.clientX, startY: e.clientY, start: box };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || dims.w === 0 || dims.h === 0) return;
    const dx = (e.clientX - d.startX) / dims.w;
    const dy = (e.clientY - d.startY) / dims.h;
    const minW = MIN_PX / dims.w;
    const minH = MIN_PX / dims.h;
    const s = d.start;
    let { x, y, w, h } = s;

    if (d.mode === "move") {
      x = clamp(s.x + dx, 0, 1 - s.w);
      y = clamp(s.y + dy, 0, 1 - s.h);
    } else {
      if (d.mode.includes("w")) {
        x = clamp(s.x + dx, 0, s.x + s.w - minW);
        w = s.x + s.w - x;
      }
      if (d.mode.includes("e")) {
        w = clamp(s.w + dx, minW, 1 - s.x);
      }
      if (d.mode.includes("n")) {
        y = clamp(s.y + dy, 0, s.y + s.h - minH);
        h = s.y + s.h - y;
      }
      if (d.mode.includes("s")) {
        h = clamp(s.h + dy, minH, 1 - s.y);
      }
    }
    setBox({ x, y, w, h });
  }

  function onPointerUp() {
    drag.current = null;
  }

  async function rotate() {
    setBusy(true);
    try {
      setWorking(await rotateBlob(working, outType));
      setRotated(true);
      setBox(FULL);
    } catch {
      // leave the image as it was if the browser can't rotate it
    } finally {
      setBusy(false);
    }
  }

  async function apply(useFull: boolean) {
    const isWhole = useFull || (box.w >= 0.995 && box.h >= 0.995);
    if (isWhole && !rotated) {
      onDone(file);
      return;
    }
    setBusy(true);
    try {
      const bitmap = await createImageBitmap(working);
      const region = isWhole ? FULL : box;
      const sx = Math.round(region.x * bitmap.width);
      const sy = Math.round(region.y * bitmap.height);
      const sw = Math.max(1, Math.round(region.w * bitmap.width));
      const sh = Math.max(1, Math.round(region.h * bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas unsupported");
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
      bitmap.close();
      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, outType, 0.92));
      if (!blob) throw new Error("crop failed");
      const ext = outType === "image/png" ? ".png" : ".jpg";
      onDone(new File([blob], file.name.replace(/\.[^.]+$/, "") + ext, { type: outType }));
    } catch {
      onDone(file);
    }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(94vw, 760px)", maxHeight: "94vh", display: "flex", flexDirection: "column", boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: "#101828" }}>Crop evidence</h3>
          <span style={{ fontSize: 12, color: "#667085" }}>Drag the corners or edges so only the receipt is inside the box</span>
        </div>

        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", background: "#f2f4f7", borderRadius: 8, padding: 10, margin: "10px 0", minHeight: 160, overflow: "hidden" }}>
          <div style={{ position: "relative", lineHeight: 0, userSelect: "none", touchAction: "none", overflow: "hidden" }}>
            {url && (
              <img
                ref={imgRef}
                src={url}
                alt="Evidence to crop"
                draggable={false}
                onLoad={measure}
                onError={() => onDone(file)}
                style={{ maxWidth: "100%", maxHeight: "58vh", display: "block" }}
              />
            )}
            {dims.w > 0 && (
              <div
                onPointerDown={(e) => onPointerDown(e, "move")}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                style={{
                  position: "absolute",
                  left: box.x * dims.w,
                  top: box.y * dims.h,
                  width: box.w * dims.w,
                  height: box.h * dims.h,
                  border: "2px solid #2a78d6",
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)",
                  cursor: "move",
                  touchAction: "none",
                  boxSizing: "border-box",
                }}
              >
                {HANDLES.map((h) => (
                  <div
                    key={h.mode}
                    onPointerDown={(e) => onPointerDown(e, h.mode)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    style={{ position: "absolute", width: 14, height: 14, background: "#fff", border: "2px solid #2a78d6", borderRadius: 3, touchAction: "none", cursor: h.cursor, ...h.style }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <span style={{ display: "flex", gap: 8 }}>
            <button type="button" className="secondary" disabled={busy} onClick={rotate}>
              Rotate
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => setBox(FULL)}>
              Reset
            </button>
          </span>
          <span style={{ display: "flex", gap: 8 }}>
            <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => apply(true)}>
              Use full image
            </button>
            <button type="button" disabled={busy} onClick={() => apply(false)}>
              {busy ? "Working…" : "Crop & attach"}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
