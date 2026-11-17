import { CSSProperties, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import type { PageViewport } from "pdfjs-dist";
import { Util } from "pdfjs-dist";
import { Ann, LINE_HEIGHT, PageRef, PdfSource, Tool } from "./types";
import { annBox, fontFamily, newId } from "./draw";
import { matchLocalFont } from "./localFonts";

interface TextRun {
  str: string;
  x: number;
  baseline: number;
  size: number;
  width: number;
  fontName: string;
}

export interface ToolStyle {
  color: string;
  size: number;
  lineWidth: number;
}

type Dir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const DIRS: Dir[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const runBox = (r: TextRun): Box => ({ x: r.x - 1, y: r.baseline - r.size * 0.92, w: r.width + 2, h: r.size * 1.2 });

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
  const [marquee, setMarquee] = useState<Box | null>(null);
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
      const raw: TextRun[] = [];
      for (const it of content.items) {
        if (!it.str) continue;
        const t = Util.transform(viewport.transform, it.transform) as number[];
        if (Math.abs(t[1]) > 0.01 || t[0] <= 0) continue; // only horizontal text can be edited
        const size = Math.hypot(t[0], t[1]);
        raw.push({ str: it.str, x: t[4], baseline: t[5], size, width: it.width * viewport.scale, fontName: it.fontName });
      }
      // PDFs store text in small pieces (often one per word). Join the pieces that sit on one line in the same
      // font and size, so a whole phrase is edited at once and keeps its look.
      const list: TextRun[] = [];
      for (const r of raw) {
        const last = list[list.length - 1];
        const gap = last ? r.x - (last.x + last.width) : 0;
        if (last && last.fontName === r.fontName && Math.abs(last.size - r.size) < 0.4 && Math.abs(last.baseline - r.baseline) < 0.8 && gap > -r.size * 0.3 && gap < r.size * 0.9) {
          const needSpace = gap > r.size * 0.12 && !last.str.endsWith(" ") && !r.str.startsWith(" ");
          last.str += (needSpace ? " " : "") + r.str;
          last.width = r.x + r.width - last.x;
        } else {
          list.push({ ...r });
        }
      }
      setRuns(list.filter((r) => r.str.trim().length > 0));
    });
    return () => {
      alive = false;
    };
  }, [geo, tool]);

  const point = (e: { clientX: number; clientY: number }) => {
    const r = overlayRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };

  /** Starts moving an existing annotation, or dragging one of its edges/corners to resize it. */
  function startDrag(e: ReactPointerEvent, a: Ann, mode: "move" | Dir, keepSelection = false) {
    if (tool !== "select" && tool !== "edit") return;
    e.stopPropagation();
    e.preventDefault();
    if (!keepSelection) onSelect(a.id);
    onGestureStart();
    const start = point(e);
    const move = (ev: PointerEvent) => {
      const p = point(ev);
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      onLive((list) =>
        list.map((x) => {
          if (x.id !== a.id) return x;
          if (mode !== "move" && (a.kind === "cover" || a.kind === "rect" || a.kind === "highlight" || a.kind === "image")) {
            let { x: nx, y: ny, w: nw, h: nh } = a;
            if (mode.includes("e")) nw = Math.max(4, a.w + dx);
            if (mode.includes("s")) nh = Math.max(4, a.h + dy);
            if (mode.includes("w")) {
              nw = Math.max(4, a.w - dx);
              nx = a.x + a.w - nw;
            }
            if (mode.includes("n")) {
              nh = Math.max(4, a.h - dy);
              ny = a.y + a.h - nh;
            }
            return { ...(x as typeof a), x: nx, y: ny, w: nw, h: nh };
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

  /**
   * Edit-text tool: a click edits the line under the pointer; dragging a box
   * edits everything inside it as one piece of text, so the area can be made
   * as wide or as narrow as needed.
   */
  function startMarquee(e: ReactPointerEvent, hit: TextRun | null) {
    e.preventDefault();
    e.stopPropagation();
    onSelect(null);
    const origin = point(e);
    let rect: Box = { x: origin.x, y: origin.y, w: 0, h: 0 };
    const move = (ev: PointerEvent) => {
      const q = point(ev);
      rect = { x: Math.min(origin.x, q.x), y: Math.min(origin.y, q.y), w: Math.abs(q.x - origin.x), h: Math.abs(q.y - origin.y) };
      setMarquee(rect);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setMarquee(null);
      if (rect.w < 4 && rect.h < 4) {
        if (hit) void editRuns([hit]);
        return;
      }
      const inside = runs.filter((r) => {
        const b = runBox(r);
        const ow = Math.min(b.x + b.w, rect.x + rect.w) - Math.max(b.x, rect.x);
        const oh = Math.min(b.y + b.h, rect.y + rect.h) - Math.max(b.y, rect.y);
        return ow > b.w * 0.25 && oh > b.h * 0.4;
      });
      if (inside.length === 0) return;
      inside.sort((a, b) => (Math.abs(a.baseline - b.baseline) > Math.min(a.size, b.size) * 0.6 ? a.baseline - b.baseline : a.x - b.x));
      void editRuns(inside, rect);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** Pointer down on the empty page: starts drawing with the active tool. */
  function onOverlayDown(e: ReactPointerEvent) {
    if (e.target !== overlayRef.current && e.target !== e.currentTarget) return;
    const p = point(e);
    if (tool === "edit") {
      startMarquee(e, null);
      return;
    }
    if (tool === "select") {
      onSelect(null);
      return;
    }
    if (tool === "text") {
      const a: Ann = { id: newId(), kind: "text", x: p.x, y: p.y, text: "Text", size: style.size, color: style.color, bold: false, italic: false, serif: false };
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

  /** Cover existing text (one line, or everything inside a dragged box) and put an editable copy in its place. */
  async function editRuns(list: TextRun[], region?: Box) {
    const run = list[0];
    const canvas = canvasRef.current;
    const box = region ?? { x: run.x - 1.5, y: run.baseline - run.size * 0.92, w: run.width + 3, h: run.size * 1.2 };
    const lines: string[] = [];
    let current = "";
    let prev: TextRun | null = null;
    for (const r of list) {
      if (!prev) current = r.str;
      else if (Math.abs(r.baseline - prev.baseline) > prev.size * 0.6) {
        lines.push(current);
        current = r.str;
      } else {
        const gap = r.x - (prev.x + prev.width);
        current += (gap > r.size * 0.12 && !current.endsWith(" ") && !r.str.startsWith(" ") ? " " : "") + r.str;
      }
      prev = r;
    }
    lines.push(current);
    const joined = lines.join("\n");
    let bg = "#ffffff";
    let fg = "#000000";
    if (canvas) {
      // The most common colour inside the box is the page background; the colour furthest from it is the text.
      const dpr = window.devicePixelRatio || 1;
      const sx = Math.max(0, Math.floor(box.x * zoom * dpr));
      const sy = Math.max(0, Math.floor(box.y * zoom * dpr));
      const sw = Math.max(1, Math.min(canvas.width - sx, Math.ceil(box.w * zoom * dpr)));
      const sh = Math.max(1, Math.min(canvas.height - sy, Math.ceil(box.h * zoom * dpr)));
      try {
        const data = canvas.getContext("2d")!.getImageData(sx, sy, sw, sh).data;
        const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
        for (let i = 0; i < data.length; i += 4) {
          const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
          const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
          e.n++;
          e.r += data[i];
          e.g += data[i + 1];
          e.b += data[i + 2];
          buckets.set(key, e);
        }
        let top = { n: 0, r: 255, g: 255, b: 255 };
        for (const e of buckets.values()) if (e.n > top.n) top = e;
        const br = Math.round(top.r / Math.max(1, top.n));
        const bgc = Math.round(top.g / Math.max(1, top.n));
        const bb = Math.round(top.b / Math.max(1, top.n));
        let far = { d: -1, r: 0, g: 0, b: 0 };
        for (let i = 0; i < data.length; i += 4) {
          const d = Math.abs(data[i] - br) + Math.abs(data[i + 1] - bgc) + Math.abs(data[i + 2] - bb);
          if (d > far.d) far = { d, r: data[i], g: data[i + 1], b: data[i + 2] };
        }
        const hex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
        bg = hex(br, bgc, bb);
        const lum = 0.299 * br + 0.587 * bgc + 0.114 * bb;
        fg = far.d > 60 ? hex(far.r, far.g, far.b) : lum > 110 ? "#000000" : "#ffffff";
      } catch {
        /* keep the defaults */
      }
    }
    // Match the original font style where the PDF tells us.
    let bold = false;
    let italic = false;
    let serif = false;
    let fontKey: string | undefined;
    let name = run.fontName ?? "";
    try {
      const f: any = geo?.js?.commonObjs.has(run.fontName) ? geo.js.commonObjs.get(run.fontName) : null;
      name = String(f?.name ?? run.fontName ?? "");
      bold = !!f?.bold || /bold|black|heavy|semibold|demi/i.test(name);
      italic = !!f?.italic || /italic|oblique/i.test(name);
      serif = !!f?.isSerifFont || /times|serif|georgia|cambria|garamond|palatino|book/i.test(name);
      if (/sans|arial|helvet|calibri|verdana|tahoma/i.test(name)) serif = false;
    } catch {
      /* default look */
    }
    // The same font installed on this computer gives an exact match (the browser asks permission once).
    const local = await matchLocalFont(name, bold, italic);
    if (local) fontKey = local.key;
    const cover: Ann = { id: newId(), kind: "cover", x: box.x, y: box.y, w: box.w, h: box.h, color: bg };
    const text: Ann = {
      id: newId(),
      kind: "text",
      coverId: cover.id,
      x: run.x,
      y: run.baseline - run.size * 0.9465,
      text: joined,
      size: Math.round(run.size * 10) / 10,
      color: fg,
      // The real font already is bold or italic where it should be, so don't style it a second time.
      bold: fontKey ? false : bold,
      italic: fontKey ? false : italic,
      serif,
      fontKey,
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
              title="Click to edit this text, or drag a box over several lines to edit them together"
              style={{ left: (r.x - 1) * zoom, top: (r.baseline - r.size * 0.92) * zoom, width: (r.width + 2) * zoom, height: r.size * 1.2 * zoom }}
              onPointerDown={(e) => startMarquee(e, r)}
            />
          ))}
        {marquee && <div className="pdfed-marquee" style={{ left: marquee.x * zoom, top: marquee.y * zoom, width: marquee.w * zoom, height: marquee.h * zoom }} />}

        {all.map((a) => {
          const sel = a.id === selectedId;
          const box = annBox(a, probe);
          const common = {
            onPointerDown: (e: ReactPointerEvent) => startDrag(e, a, "move"),
          };
          const resizable = a.kind === "cover" || a.kind === "rect" || a.kind === "highlight" || a.kind === "image";
          // Edited text carries its whiteout along: show its handles too, so the covered area can be widened or narrowed.
          const pairedCover = sel && a.kind === "text" && a.coverId ? anns.find((c) => c.id === a.coverId) : undefined;
          const frame = sel ? (
            <>
              <div className="pdfed-sel" style={{ left: box.x * zoom - 2, top: box.y * zoom - 2, width: box.w * zoom + 4, height: box.h * zoom + 4 }}>
                {resizable && DIRS.map((d) => <span key={d} className={`pdfed-h pdfed-h-${d}`} onPointerDown={(e) => startDrag(e, a, d)} />)}
              </div>
              {pairedCover && pairedCover.kind === "cover" && (
                <div
                  className="pdfed-sel pdfed-sel-cover"
                  style={{ left: pairedCover.x * zoom - 1, top: pairedCover.y * zoom - 1, width: pairedCover.w * zoom + 2, height: pairedCover.h * zoom + 2 }}
                >
                  {DIRS.map((d) => (
                    <span key={d} className={`pdfed-h pdfed-h-${d}`} onPointerDown={(e) => startDrag(e, pairedCover, d, true)} />
                  ))}
                </div>
              )}
            </>
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
                  fontStyle: a.italic ? "italic" : "normal",
                  fontFamily: fontFamily(a.serif, a.fontKey),
                  pointerEvents: tool === "select" || tool === "edit" ? "auto" : "none",
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
                {(tool === "select" || tool === "edit") && (
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
                style={{ left: a.x * zoom, top: a.y * zoom, width: a.w * zoom, height: a.h * zoom, pointerEvents: tool === "select" || tool === "edit" ? "auto" : "none" }}
              />
            );
          } else {
            const css: CSSProperties = { left: a.x * zoom, top: a.y * zoom, width: a.w * zoom, height: a.h * zoom, pointerEvents: tool === "select" || tool === "edit" ? "auto" : "none" };
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
