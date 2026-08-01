import { SyntheticEvent, useEffect, useRef, useState, WheelEvent } from "react";

interface AttachmentViewerProps {
  filename: string;
  /** If omitted, image-vs-PDF is inferred from the filename's extension. */
  mimeType?: string;
  /** Called once, lazily, when the viewer mounts — the modal (with a
   * loading state) opens immediately so clicking View never looks
   * unresponsive while the file is still coming down the wire. */
  fetchBlob: () => Promise<Blob>;
  onClose: () => void;
}

/**
 * Shared evidence viewer for every Attach/View surface in the app. Images
 * get cursor-anchored wheel/click zoom (matches the original receipt
 * viewer's feel — the point under the cursor stays put while zooming, like
 * Google Maps/Figma); PDFs render in an iframe and rely on the browser's
 * own built-in PDF viewer for zoom, which already has it.
 */
export function AttachmentViewer({ filename, mimeType, fetchBlob, onClose }: AttachmentViewerProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [fitSize, setFitSize] = useState<{ width: number; height: number } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const isImage = mimeType ? mimeType.startsWith("image/") : !filename.toLowerCase().endsWith(".pdf");
  const [pdfAutoOpened, setPdfAutoOpened] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchBlob()
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
        // A PDF embedded in this modal via <iframe> fights the browser's own
        // PDF viewer for layout (it renders as a cramped strip instead of a
        // full page) — opening it in its own tab gives it the full window
        // and the browser's real zoom/page controls instead. Best-effort:
        // this fires from an async callback, not a synchronous click, so
        // some browsers' popup blockers may still block it — the fallback
        // "Open PDF" link below always works regardless.
        if (!isImage) {
          const opened = window.open(objectUrl, "_blank", "noopener,noreferrer");
          setPdfAutoOpened(!!opened);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load attachment");
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleImageLoad(e: SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    const container = containerRef.current;
    if (!container || img.naturalWidth === 0 || img.naturalHeight === 0) return;
    const rect = container.getBoundingClientRect();
    const scale = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight, 1);
    setFitSize({ width: img.naturalWidth * scale, height: img.naturalHeight * scale });
  }

  function zoomAt(factor: number, clientX?: number, clientY?: number) {
    const prevZoom = zoom;
    const newZoom = Math.min(4, Math.max(1, prevZoom * factor));
    if (newZoom === prevZoom) return;
    if (newZoom <= 1) {
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      return;
    }
    const imgEl = imgRef.current;
    if (imgEl) {
      const rect = imgEl.getBoundingClientRect();
      const cx = (clientX ?? rect.left + rect.width / 2) - rect.left;
      const cy = (clientY ?? rect.top + rect.height / 2) - rect.top;
      setOffset((prev) => ({
        x: prev.x + cx * (1 - newZoom / prevZoom),
        y: prev.y + cy * (1 - newZoom / prevZoom),
      }));
    }
    setZoom(newZoom);
  }

  function resetZoom() {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }

  function handleWheel(e: WheelEvent) {
    if (!isImage) return;
    e.preventDefault();
    zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
  }

  return (
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
      onClick={onClose}
    >
      <div
        style={{ background: "#fff", borderRadius: 8, padding: 16, maxWidth: "90vw", maxHeight: "90vh", display: "flex", flexDirection: "column", gap: 12 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 24 }}>
          <strong style={{ color: "#101828" }}>{filename}</strong>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {isImage && url && (
              <>
                <button type="button" className="secondary" onClick={() => zoomAt(1 / 1.25)} title="Zoom out">
                  −
                </button>
                <span style={{ color: "#667085", fontSize: 13, minWidth: 42, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
                <button type="button" className="secondary" onClick={() => zoomAt(1.25)} title="Zoom in">
                  +
                </button>
                <button type="button" className="secondary" onClick={resetZoom} title="Reset zoom">
                  Reset
                </button>
              </>
            )}
            <button type="button" className="secondary" onClick={onClose}>
              Close
            </button>
          </span>
        </div>
        <div
          ref={containerRef}
          onWheel={handleWheel}
          style={{ overflow: "hidden", flex: 1, width: "85vw", height: "75vh", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          {error && <p style={{ color: "#b42318" }}>{error}</p>}
          {!error && !url && <p style={{ color: "#667085" }}>Loading…</p>}
          {url && isImage && (
            <img
              ref={imgRef}
              src={url}
              alt={filename}
              onLoad={handleImageLoad}
              style={{
                ...(fitSize ? { width: fitSize.width, height: fitSize.height } : { maxWidth: "100%", maxHeight: "100%", visibility: "hidden" }),
                display: "block",
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                transformOrigin: "0 0",
                cursor: zoom < 4 ? "zoom-in" : "default",
              }}
              onClick={(e) => zoomAt(1.5, e.clientX, e.clientY)}
            />
          )}
          {url && !isImage && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
              <p style={{ color: "#667085" }}>
                {pdfAutoOpened
                  ? "Opened in a new tab for full-page viewing with your browser's own zoom and page controls."
                  : "Your browser blocked the automatic pop-up — open it manually:"}
              </p>
              <a href={url} target="_blank" rel="noopener noreferrer" className="secondary" style={{ padding: "8px 16px", textDecoration: "none" }}>
                Open PDF in new tab
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
