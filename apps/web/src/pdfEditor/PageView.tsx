import { CSSProperties, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import type { PageViewport } from "pdfjs-dist";
import { Util } from "pdfjs-dist";
import { Ann, FONT_STACK, LINE_HEIGHT, PageRef, PdfSource, Tool } from "./types";
import { annBox, newId } from "./draw";

interface TextRun {
  str: string;
  x: number;
  baseline: number;
  size: number;
  width: number;
}

export interface ToolStyle {
  color: string;
  size: number;
  lineWidth: number;
}

interface Props {
  page: PageRef;
  source: PdfSource | undefined;
  anns: Ann[];
  zoom: number;
  tool: Tool;
  style: ToolStyle;
  selectedId: string | null;
  onSize: (w: number, h: number) => void;
  onSelect: (id: string | null) => void;
  /** Called once when a gesture starts, so the whole gesture is a single undo step. */
  onGestureStart: () => void;
  /** Replaces annotations without recording history (used during a gesture). */
  onLive: (fn: (list: Ann[]) => Ann[]) => void;
  /** Adds annotations as one undo step. */
  onAdd: (list: Ann[], select: string | null) => void;
}

/** Display size of a page in PDF points, after rotation. */
export function usePageViewport(page: PageRef, source: PdfSource | undefined) {
  const [vp, setVp] = useState<{ viewport: PageViewport | null; w: number; h: number; js: any } | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (page.src === -1 || !source) {
        const { w, h } = page.blank ?? { w: 595, h: 842 };
        if (alive) setVp({ viewport: null, w, h, js: null });
        return;
      }
      const js = await source.pdf.getPage(page.index + 1);
      const viewport = js.getViewport({ scale: 1, rotation: (js.rotate + page.rotation) % 360 });
      if (alive) setVp({ viewport, w: viewport.width, h: viewport.height, js });
    })();
    return () => {
      alive = false;
    };
  }, [page, source]);
  return vp;
}

export function PageView({ page, source, anns, zoom, tool, style, selectedId, onSize, onSelect, onGestureStart, onLive, onAdd }: Props) {
  const geo = usePageViewport(page, source);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [runs, setRuns] = useState<TextRun[]>([]);
  const [draft, setDraft] = useState<Ann | null>(null);
  const probe = useMemo(() => document.createElement("canvas").getContext("2d")!, []);

  useEffect(() => {
    if (geo) onSize(geo.w, geo.h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo?.w, geo?.h]);

  // Draw the page itself.
  useEffect(() => {
    if (!geo || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.ceil(geo.w * zoom * dpr);
    canvas.height = Math.ceil(geo.h * zoom * dpr);
    canvas.style.width = `${geo.w * zoom}px`;
    canvas.style.height = `${geo.h * zoom}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!geo.js || !geo.viewport) return;
    const task = geo.js.render({ canvasContext: ctx, viewport: geo.js.getViewport({ scale: zoom * dpr, rotation: geo.viewport.rotation }) });
    task.promise.catch(() => undefined); // a cancelled render rejects, which is expected
    return () => task.cancel();
  }, [geo, zoom]);

  // Existing text, for the "Edit text" tool.
  useEffect(() => {
    setRuns([]);
    if (tool !== "edit" || !geo?.js || !geo.viewport) return;
    let alive = true;
    const viewport = geo.viewport;
    geo.js.getTextContent().then((content: any) => {
      if (!alive) return;
      const list: TextRun[] = [];
      for (const it of content.items) {
        if (!it.str || !it.str.trim()) continue;
        const t = Util.transform(viewport.transform, it.transform) as number[];
        if (Math.abs(t[1]) > 0.01 || t[0] <= 0) continue; // only horizontal text can be edited
        const size = Math.hypot(t[0], t[1]);
        list.push({ str: it.str, x: t[4], baseline: t[5], size, width: it.width * viewport.scale });
      }
      setRuns(list);
    });
    return () => {
      alive = false;
    };
  }, [geo, tool]);

  const point = (e: { clientX: number; clientY: number }) => {
    const r = overlayRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };

  /** Starts moving or resizing an existing annotation. */
  function startDrag(e: ReactPointerEvent, a: Ann, mode: "move" | "resize") {
    if (tool !== "select") return;
    e.stopPropagation();
    e.preventDefault();
    onSelect(a.id);
    onGestureStart();
    const start = point(e);
    const move = (ev: PointerEvent) => {
      const p = point(ev);
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      onLive((list) =>
        list.map((x) => {
          if (x.id !== a.id) return x;
          if (mode === "resize" && (a.kind === "cover" || a.kind === "rect" || a.kind === "highlight" || a.kind === "image")) {
            return { ...(x as typeof a), w: Math.max(4, a.w + dx), h: Math.max(4, a.h + dy) };
          }
          if (a.kind === "pen") return { ...(x as typeof a), points: a.points.map(([px, py]) => [px + dx, py + dy] as [number, number]) };
          if ("x" in a) return { ...(x as typeof a), x: a.x + dx, y: a.y + dy };
          return x;
        }),
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** Pointer down on the empty page: starts drawing with the active tool. */
  function onOverlayDown(e: ReactPointerEvent) {
    if (e.target !== overlayRef.current && e.target !== e.currentTarget) return;
    const p = point(e);
    if (tool === "select" || tool === "edit") {
      onSelect(null);
      return;
    }
    if (tool === "text") {
      const a: Ann = { id: newId(), kind: "text", x: p.x, y: p.y, text: "Text", size: style.size, color: style.color, bold: false };
      onAdd([a], a.id);
      return;
    }
    e.preventDefault();
    const id = newId();
    let current: Ann;
    if (tool === "pen") current = { id, kind: "pen", points: [[p.x, p.y]], color: style.color, width: style.lineWidth };
    else if (tool === "cover") current = { id, kind: "cover", x: p.x, y: p.y, w: 0, h: 0, color: style.color };
    else if (tool === "highlight") current = { id, kind: "highlight", x: p.x, y: p.y, w: 0, h: 0, color: style.color };
    else current = { id, kind: "rect", x: p.x, y: p.y, w: 0, h: 0, color: style.color, width: style.lineWidth };
    setDraft(current);
    const move = (ev: PointerEvent) => {
      const q = point(ev);
      if (current.kind === "pen") {
        current = { ...current, points: [...current.points, [q.x, q.y]] };
      } else if (current.kind !== "text" && current.kind !== "image") {
        current = { ...current, x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y) };
      }
      setDraft(current);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDraft(null);
      const tiny = current.kind === "pen" ? current.points.length < 2 : "w" in current && (current.w < 3 || current.h < 3);
      if (!tiny) onAdd([current], current.id);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** Clicking an existing line of text: cover it and put an editable copy in its place. */
  function editRun(run: TextRun) {
    const canvas = canvasRef.current;
    let bg = "#ffffff";
    let dark = true;
    if (canvas) {
      const dpr = window.devicePixelRatio || 1;
      const px = Math.max(0, Math.floor((run.x - 2) * zoom * dpr));
      const py = Math.max(0, Math.floor((run.baseline - run.size * 0.3) * zoom * dpr));
      try {
        const d = canvas.getContext("2d")!.getImageData(px, py, 1, 1).data;
        bg = `#${[d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
        dark = 0.299 * d[0] + 0.587 * d[1] + 0.114 * d[2] > 110;
      } catch {
        /* keep white */
      }
    }
    const cover: Ann = {
      id: newId(),
      kind: "cover",
      x: run.x - 1.5,
      y: run.baseline - run.size * 0.92,
      w: run.width + 3,
      h: run.size * 1.2,
      color: bg,
    };
    const text: Ann = {
      id: newId(),
      kind: "text",
      x: run.x,
      y: run.baseline - run.size * 0.9465,
      text: run.str,
      size: Math.round(run.size * 10) / 10,
      color: dark ? "#000000" : "#ffffff",
      bold: false,
    };
    onAdd([cover, text], text.id);
  }

  if (!geo) return <div className="pdfed-page-loading">Loading page…</div>;

  const all = draft ? [...anns, draft] : anns;
  const cursor = tool === "select" ? "default" : tool === "edit" ? "pointer" : tool === "text" ? "text" : "crosshair";

  return (
    <div className="pdfed-page" style={{ width: geo.w * zoom, height: geo.h * zoom }}>
      <canvas ref={canvasRef} />
      <div ref={overlayRef} className="pdfed-overlay" style={{ cursor }} onPointerDown={onOverlayDown}>
        {tool === "edit" &&
          runs.map((r, i) => (
            <div
              key={i}
              className="pdfed-run"
              title="Click to edit this text"
              style={{ left: (r.x - 1) * zoom, top: (r.baseline - r.size * 0.92) * zoom, width: (r.width + 2) * zoom, height: r.size * 1.2 * zoom }}
              onClick={() => editRun(r)}
            />
          ))}

        {all.map((a) => {
          const sel = a.id === selectedId;
          const box = annBox(a, probe);
          const common = {
            onPointerDown: (e: ReactPointerEvent) => startDrag(e, a, "move"),
          };
          const frame = sel ? (
            <div className="pdfed-sel" style={{ left: box.x * zoom - 2, top: box.y * zoom - 2, width: box.w * zoom + 4, height: box.h * zoom + 4 }}>
              {(a.kind === "cover" || a.kind === "rect" || a.kind === "highlight" || a.kind === "image") && (
                <span className="pdfed-handle" onPointerDown={(e) => startDrag(e, a, "resize")} />
              )}
            </div>
          ) : null;
          let body: JSX.Element | null = null;
          if (a.kind === "text") {
            body = (
              <div
                {...common}
                className="pdfed-text" dir="auto"
                style={{
                  left: a.x * zoom,
                  top: a.y * zoom,
                  fontSize: a.size * zoom,
                  lineHeight: LINE_HEIGHT,
                  color: a.color,
                  fontWeight: a.bold ? 700 : 400,
                  fontFamily: FONT_STACK,
                  pointerEvents: tool === "select" ? "auto" : "none",
                }}
              >
                {a.text}
              </div>
            );
          } else if (a.kind === "pen") {
            body = (
              <svg className="pdfed-pen" width={geo.w * zoom} height={geo.h * zoom}>
                <polyline
                  points={a.points.map(([x, y]) => `${x * zoom},${y * zoom}`).join(" ")}
                  fill="none"
                  stroke={a.color}
                  strokeWidth={a.width * zoom}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {tool === "select" && (
                  <polyline
                    {...common}
                    points={a.points.map(([x, y]) => `${x * zoom},${y * zoom}`).join(" ")}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={Math.max(10, a.width * zoom + 8)}
                    style={{ pointerEvents: "stroke", cursor: "move" }}
                  />
                )}
              </svg>
            );
          } else if (a.kind === "image") {
            body = (
              <img
                {...common}
                src={a.dataUrl}
                alt=""
                draggable={false}
                className="pdfed-img"
                style={{ left: a.x * zoom, top: a.y * zoom, width: a.w * zoom, height: a.h * zoom, pointerEvents: tool === "select" ? "auto" : "none" }}
              />
            );
          } else {
            const css: CSSProperties = { left: a.x * zoom, top: a.y * zoom, width: a.w * zoom, height: a.h * zoom, pointerEvents: tool === "select" ? "auto" : "none" };
            if (a.kind === "cover") css.background = a.color;
            else if (a.kind === "highlight") {
              css.background = a.color;
              css.opacity = 0.4;
              css.mixBlendMode = "multiply";
            } else css.border = `${Math.max(1, a.width * zoom)}px solid ${a.color}`;
            body = <div {...common} className="pdfed-shape" style={css} />;
          }
          return (
            <div key={a.id}>
              {body}
              {frame}
            </div>
          );
        })}
      </div>
    </div>
  );
}
