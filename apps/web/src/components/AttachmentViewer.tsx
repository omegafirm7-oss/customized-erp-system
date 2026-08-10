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
 * Shared evidence viewer for every Attach/View surface in the app. Both
 * file types share the same +/−/Reset zoom controls: images get
 * cursor-anchored wheel/click zoom (the point under the cursor stays put
 * while zooming, like Google Maps/Figma); PDFs zoom by growing the iframe's
 * own box so the browser's PDF renderer re-rasterizes at the larger size
 * (stays sharp, unlike a CSS transform: scale() which would just blow up
 * the already-rendered pixels) and pan via the container's scrollbars.
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

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchBlob()
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
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
    // PDFs zoom by growing the iframe's own box (forces the browser's PDF
    // renderer to re-layout and re-rasterize at the larger size, so it stays
    // sharp) and rely on the container's scrollbars to pan — the
    // cursor-anchored offset trick below is image-only.
    if (isImage) {
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
        style={{
          background: "#fff",
          borderRadius: 8,
          padding: 16,
          width: isImage ? "90vw" : "96vw",
          height: isImage ? "90vh" : "96vh",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 24 }}>
          <strong style={{ color: "#101828" }}>{filename}</strong>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {url && (
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
            {!isImage && url && (
              <a href={url} target="_blank" rel="noopener noreferrer" className="secondary" style={{ padding: "6px 10px", textDecoration: "none" }}>
                Open in new tab
              </a>
            )}
            <button type="button" className="secondary" onClick={onClose}>
              Close
            </button>
          </span>
        </div>
        <div
          ref={containerRef}
          onWheel={handleWheel}
          style={{
            overflow: isImage ? "hidden" : "auto",
            flex: 1,
            width: "100%",
            minHeight: 0,
            display: "flex",
            alignItems: isImage ? "center" : "flex-start",
            justifyContent: isImage ? "center" : "flex-start",
          }}
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
            <iframe
              // "#view=Fit" keeps the whole page visible (no side-scrolling
              // to read the bottom of a page) — sizing now comes from the
              // modal itself filling nearly the whole viewport, not from
              // cropping the page to the panel's width.
              src={`${url}#view=Fit`}
              title={filename}
              style={{ width: `${100 * zoom}%`, height: `${100 * zoom}%`, minWidth: "100%", minHeight: "100%", border: "none" }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
