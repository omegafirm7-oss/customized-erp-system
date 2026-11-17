import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
// Bundled as a normal .js worker so it works whatever MIME type the web server gives .mjs files.
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";
import { exportPdf } from "../pdfEditor/exportPdf";
import { newId } from "../pdfEditor/draw";
import { PageView, ToolStyle, usePageViewport } from "../pdfEditor/PageView";
import { Ann, DocState, PageRef, PdfSource, Tool } from "../pdfEditor/types";

pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();

const TOOLS: Array<{ id: Tool; label: string; hint: string }> = [
  { id: "select", label: "Select", hint: "Click to select, drag to move, drag the corner to resize" },
  { id: "edit", label: "Edit text", hint: "Click any line of existing text to change it" },
  { id: "text", label: "Add text", hint: "Click on the page where the text should go" },
  { id: "cover", label: "Whiteout", hint: "Drag over anything you want to hide" },
  { id: "highlight", label: "Highlight", hint: "Drag over text to highlight it" },
  { id: "rect", label: "Box", hint: "Drag to draw a box outline" },
  { id: "pen", label: "Draw", hint: "Draw freehand" },
];

const DEFAULT_COLORS: Record<Tool, string> = {
  select: "#000000",
  edit: "#000000",
  text: "#000000",
  cover: "#ffffff",
  highlight: "#ffe600",
  rect: "#d92d20",
  pen: "#1d4ed8",
};

const MAX_BYTES = 60 * 1024 * 1024;

let sourceCounter = 0;

function Thumb({ page, source, active, index, onClick, onDragStart, onDrop }: {
  page: PageRef;
  source: PdfSource | undefined;
  active: boolean;
  index: number;
  onClick: () => void;
  onDragStart: () => void;
  onDrop: () => void;
}) {
  const geo = usePageViewport(page, source);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !geo || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const k = 110 / geo.w;
    canvas.width = Math.ceil(geo.w * k);
    canvas.height = Math.ceil(geo.h * k);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!geo.js || !geo.viewport) return;
    const task = geo.js.render({ canvasContext: ctx, viewport: geo.js.getViewport({ scale: k, rotation: geo.viewport.rotation }) });
    task.promise.catch(() => undefined);
    return () => task.cancel();
  }, [visible, geo]);

  return (
    <div
      ref={holder}
      className={`pdfed-thumb ${active ? "on" : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onClick={onClick}
    >
      <canvas ref={canvasRef} />
      <span>{index + 1}</span>
    </div>
  );
}

export function PdfEditorPage() {
  const [sources, setSources] = useState<PdfSource[]>([]);
  const [past, setPast] = useState<DocState[]>([]);
  const [present, setPresent] = useState<DocState>({ pages: [], anns: {} });
  const [future, setFuture] = useState<DocState[]>([]);
  const [current, setCurrent] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState<Tool>("select");
  const [colors, setColors] = useState<Record<Tool, string>>(DEFAULT_COLORS);
  const [textSize, setTextSize] = useState(14);
  const [lineWidth, setLineWidth] = useState(2);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flatten, setFlatten] = useState(false);
  const [fileName, setFileName] = useState("document.pdf");
  const [dirty, setDirty] = useState(false);
  const [signing, setSigning] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const openRef = useRef<HTMLInputElement>(null);
  const mergeRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const presentRef = useRef(present);
  presentRef.current = present;
  const sourceMap = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);

  const page = present.pages[current];
  const anns = page ? (present.anns[page.key] ?? []) : [];
  const selected = anns.find((a) => a.id === selectedId) ?? null;
  const style: ToolStyle = { color: colors[tool], size: textSize, lineWidth };

  // ── history ───────────────────────────────────────────────────────────
  const checkpoint = useCallback(() => {
    setPast((p) => [...p.slice(-60), presentRef.current]);
    setFuture([]);
    setDirty(true);
  }, []);
  const change = useCallback(
    (fn: (s: DocState) => DocState, record = true) => {
      if (record) checkpoint();
      setPresent((s) => fn(s));
    },
    [checkpoint],
  );
  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      setFuture((f) => [presentRef.current, ...f]);
      setPresent(p[p.length - 1]);
      return p.slice(0, -1);
    });
    setSelectedId(null);
  }, []);
  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      setPast((p) => [...p, presentRef.current]);
      setPresent(f[0]);
      return f.slice(1);
    });
    setSelectedId(null);
  }, []);

  useEffect(() => {
    if (current > present.pages.length - 1) setCurrent(Math.max(0, present.pages.length - 1));
  }, [present.pages.length, current]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // ── annotations on the current page ───────────────────────────────────
  const setPageAnns = useCallback(
    (key: string, fn: (list: Ann[]) => Ann[], record: boolean) => change((s) => ({ ...s, anns: { ...s.anns, [key]: fn(s.anns[key] ?? []) } }), record),
    [change],
  );

  const updateSelected = (patch: Partial<Ann>) => {
    if (!page || !selected) return;
    setPageAnns(page.key, (list) => list.map((a) => (a.id === selected.id ? ({ ...a, ...patch } as Ann) : a)), true);
  };
  const deleteSelected = useCallback(() => {
    if (!page || !selectedId) return;
    setPageAnns(page.key, (list) => list.filter((a) => a.id !== selectedId), true);
    setSelectedId(null);
  }, [page, selectedId, setPageAnns]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA";
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        if (typing) return;
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        if (typing) return;
        e.preventDefault();
        redo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && !typing && selectedId) {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === "Escape") {
        setSelectedId(null);
        setTool("select");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, deleteSelected, selectedId]);

  // ── opening files ─────────────────────────────────────────────────────
  async function loadSource(file: File): Promise<PdfSource> {
    if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than 60 MB`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      return { id: ++sourceCounter, name: file.name, bytes, pdf };
    } catch (err: any) {
      if (err?.name === "PasswordException") {
        throw new Error(`${file.name} is password-protected. Remove the password first, then upload it again.`);
      }
      console.error("PDF open failed", err);
      throw new Error(`${file.name} could not be opened as a PDF${err?.message ? ": " + err.message : "."}`);
    }
  }

  async function openFile(file: File) {
    setError(null);
    if (dirty && !window.confirm("Open a different file? Your unsaved edits will be lost.")) return;
    setBusy("Opening…");
    try {
      const src = await loadSource(file);
      const pages: PageRef[] = Array.from({ length: src.pdf.numPages }, (_, i) => ({ key: newId(), src: src.id, index: i, rotation: 0 }));
      setSources([src]);
      setPresent({ pages, anns: {} });
      setPast([]);
      setFuture([]);
      setCurrent(0);
      setSelectedId(null);
      setFileName(file.name);
      setDirty(false);
      setTool("select");
      setZoom(0); // 0 = fit to width once the first page reports its size
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function mergeFiles(files: File[]) {
    setError(null);
    setBusy("Adding pages…");
    try {
      const added: PdfSource[] = [];
      const newPages: PageRef[] = [];
      for (const f of files) {
        const src = await loadSource(f);
        added.push(src);
        for (let i = 0; i < src.pdf.numPages; i++) newPages.push({ key: newId(), src: src.id, index: i, rotation: 0 });
      }
      setSources((s) => [...s, ...added]);
      change((s) => ({ ...s, pages: [...s.pages, ...newPages] }));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  function onFiles(e: ChangeEvent<HTMLInputElement>, merge: boolean) {
    const files = Array.from(e.target.files ?? []).filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    e.target.value = "";
    if (files.length === 0) return;
    if (merge) void mergeFiles(files);
    else void openFile(files[0]);
  }

  function onDropFile(e: DragEvent) {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    if (files.length === 0) return;
    if (sources.length === 0) void openFile(files[0]);
    else void mergeFiles(files);
  }

  // ── page operations ───────────────────────────────────────────────────
  const rotate = (dir: 1 | -1) => {
    if (!page || page.src === -1) return;
    change((s) => ({ ...s, pages: s.pages.map((p, i) => (i === current ? { ...p, rotation: (p.rotation + 90 * dir + 360) % 360 } : p)) }));
  };
  const deletePage = () => {
    if (!page || present.pages.length <= 1) return;
    if (!window.confirm(`Delete page ${current + 1}?`)) return;
    change((s) => ({ ...s, pages: s.pages.filter((_, i) => i !== current) }));
  };
  const addBlank = () => {
    const ref = page?.blank ?? { w: 595, h: 842 };
    const blank: PageRef = { key: newId(), src: -1, index: 0, rotation: 0, blank: ref };
    change((s) => ({ ...s, pages: [...s.pages.slice(0, current + 1), blank, ...s.pages.slice(current + 1)] }));
    setCurrent(current + 1);
  };
  const movePage = (from: number, to: number) => {
    if (from === to) return;
    change((s) => {
      const pages = [...s.pages];
      const [m] = pages.splice(from, 1);
      pages.splice(to, 0, m);
      return { ...s, pages };
    });
    setCurrent(to);
  };

  // ── images and signature ──────────────────────────────────────────────
  async function placeImage(dataUrl: string) {
    if (!page) return;
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Could not read the image"));
      img.src = dataUrl;
    });
    const w = Math.min(180, img.naturalWidth);
    const h = (img.naturalHeight / img.naturalWidth) * w;
    const geoW = pageSize.current.w || 595;
    const geoH = pageSize.current.h || 842;
    const a: Ann = { id: newId(), kind: "image", x: Math.max(0, (geoW - w) / 2), y: Math.max(0, (geoH - h) / 2), w, h, dataUrl };
    setPageAnns(page.key, (list) => [...list, a], true);
    setSelectedId(a.id);
    setTool("select");
  }

  async function onImageFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * k);
      c.height = Math.round(bmp.height * k);
      c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
      await placeImage(c.toDataURL("image/png"));
    } catch {
      setError("That image could not be read.");
    }
  }

  // ── zoom ──────────────────────────────────────────────────────────────
  const pageSize = useRef({ w: 0, h: 0 });
  const fit = useCallback(() => {
    const avail = (mainRef.current?.clientWidth ?? 800) - 48;
    if (pageSize.current.w > 0) setZoom(Math.max(0.3, Math.min(2, avail / pageSize.current.w)));
  }, []);
  const onSize = useCallback(
    (w: number, h: number) => {
      pageSize.current = { w, h };
      if (zoom === 0) fit();
    },
    [zoom, fit],
  );

  // ── export ────────────────────────────────────────────────────────────
  async function download() {
    setError(null);
    setBusy("Preparing your PDF…");
    try {
      const bytes = await exportPdf(sourceMap, present, { flatten }, (d, t) => setBusy(`Preparing your PDF… ${d}/${t}`));
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName.replace(/\.pdf$/i, "") + "-edited.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setDirty(false);
    } catch (err: any) {
      setError(err?.message ?? "Could not create the PDF");
    } finally {
      setBusy(null);
    }
  }

  const hasCovers = Object.values(present.anns).some((l) => l.some((a) => a.kind === "cover"));
  const activeTool = TOOLS.find((t) => t.id === tool)!;

  // ── empty state ───────────────────────────────────────────────────────
  if (sources.length === 0) {
    return (
      <div className="pdfed-empty" onDragOver={(e) => e.preventDefault()} onDrop={onDropFile}>
        <h2>PDF Editor</h2>
        <p>Upload any PDF to edit text, hide or highlight parts, draw, add images and signatures, and rearrange, rotate or merge pages.</p>
        <button type="button" onClick={() => openRef.current?.click()} disabled={!!busy}>
          {busy ?? "Upload a PDF"}
        </button>
        <p className="pdfed-note">or drop a file here. Your file is edited inside your browser and is never uploaded to our servers.</p>
        {error && <div className="error-banner">{error}</div>}
        <input ref={openRef} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => onFiles(e, false)} />
      </div>
    );
  }

  return (
    <div className="pdfed" onDragOver={(e) => e.preventDefault()} onDrop={onDropFile}>
      <div className="pdfed-bar">
        <button type="button" className="secondary" onClick={() => openRef.current?.click()}>
          Open another
        </button>
        <button type="button" className="secondary" onClick={undo} disabled={past.length === 0} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button type="button" className="secondary" onClick={redo} disabled={future.length === 0} title="Redo (Ctrl+Y)">
          Redo
        </button>
        <span className="pdfed-sep" />
        {TOOLS.map((t) => (
          <button key={t.id} type="button" className={tool === t.id ? "" : "secondary"} title={t.hint} onClick={() => setTool(t.id)}>
            {t.label}
          </button>
        ))}
        <button type="button" className="secondary" onClick={() => setSigning(true)} title="Draw your signature and place it">
          Signature
        </button>
        <button type="button" className="secondary" onClick={() => imageRef.current?.click()} title="Insert a picture or stamp">
          Image
        </button>
        <span className="pdfed-sep" />
        <button type="button" className="secondary" onClick={() => setZoom((z) => Math.max(0.3, (z || 1) - 0.15))}>
          −
        </button>
        <span className="pdfed-zoom">{Math.round((zoom || 1) * 100)}%</span>
        <button type="button" className="secondary" onClick={() => setZoom((z) => Math.min(3, (z || 1) + 0.15))}>
          +
        </button>
        <button type="button" className="secondary" onClick={fit}>
          Fit
        </button>
        <span style={{ flex: 1 }} />
        <label className="pdfed-flat" title="Turns every page into a picture so covered text is really removed. Use it for redactions.">
          <input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} /> Flatten (secure)
        </label>
        <button type="button" onClick={download} disabled={!!busy}>
          {busy ?? "Download PDF"}
        </button>
      </div>
      <p className="pdfed-hint">
        <strong>{activeTool.label}:</strong> {activeTool.hint}.
        {hasCovers && !flatten && " Whiteout only covers content. Tick Flatten (secure) before downloading to remove it for good."}
      </p>
      {error && <div className="error-banner">{error}</div>}

      <div className="pdfed-body">
        <div className="pdfed-side">
          <div className="pdfed-side-actions">
            <button type="button" className="secondary" onClick={() => rotate(-1)} title="Rotate left" disabled={page?.src === -1}>
              ⟲
            </button>
            <button type="button" className="secondary" onClick={() => rotate(1)} title="Rotate right" disabled={page?.src === -1}>
              ⟳
            </button>
            <button type="button" className="secondary" onClick={deletePage} title="Delete this page" disabled={present.pages.length <= 1}>
              Delete
            </button>
            <button type="button" className="secondary" onClick={addBlank} title="Insert a blank page after this one">
              + Blank
            </button>
            <button type="button" className="secondary" onClick={() => mergeRef.current?.click()} title="Add pages from other PDFs at the end">
              + PDF
            </button>
          </div>
          <div className="pdfed-thumbs">
            {present.pages.map((p, i) => (
              <Thumb
                key={p.key + p.rotation}
                page={p}
                source={sourceMap.get(p.src)}
                active={i === current}
                index={i}
                onClick={() => {
                  setCurrent(i);
                  setSelectedId(null);
                }}
                onDragStart={() => setDragFrom(i)}
                onDrop={() => {
                  if (dragFrom !== null) movePage(dragFrom, i);
                  setDragFrom(null);
                }}
              />
            ))}
          </div>
        </div>

        <div className="pdfed-main" ref={mainRef}>
          {page && zoom > 0 && (
            <PageView
              key={page.key + ":" + page.rotation}
              page={page}
              source={sourceMap.get(page.src)}
              anns={anns}
              zoom={zoom}
              tool={tool}
              style={style}
              selectedId={selectedId}
              onSize={onSize}
              onSelect={setSelectedId}
              onGestureStart={checkpoint}
              onLive={(fn) => setPageAnns(page.key, fn, false)}
              onAdd={(list, select) => {
                setPageAnns(page.key, (l) => [...l, ...list], true);
                setSelectedId(select);
                if (tool === "text" || tool === "edit") setTool(tool === "text" ? "select" : "edit");
              }}
            />
          )}
          {page && zoom === 0 && (
            <div style={{ visibility: "hidden", height: 0, overflow: "hidden" }}>
              <PageView
                key={page.key + ":" + page.rotation + ":probe"}
                page={page}
                source={sourceMap.get(page.src)}
                anns={[]}
                zoom={0.01}
                tool="select"
                style={style}
                selectedId={null}
                onSize={onSize}
                onSelect={() => undefined}
                onGestureStart={() => undefined}
                onLive={() => undefined}
                onAdd={() => undefined}
              />
            </div>
          )}
          <div className="pdfed-pager">
            <button type="button" className="secondary" disabled={current === 0} onClick={() => setCurrent(current - 1)}>
              Previous
            </button>
            <span>
              Page {current + 1} of {present.pages.length}
            </span>
            <button type="button" className="secondary" disabled={current >= present.pages.length - 1} onClick={() => setCurrent(current + 1)}>
              Next
            </button>
          </div>
        </div>

        <div className="pdfed-props">
          <h4>{selected ? "Selected" : "Options"}</h4>
          {!selected && tool !== "select" && tool !== "edit" && (
            <>
              <label>Colour</label>
              <input type="color" value={colors[tool]} onChange={(e) => setColors({ ...colors, [tool]: e.target.value })} />
              {tool === "text" && (
                <>
                  <label>Text size</label>
                  <input type="number" min={4} max={200} value={textSize} onChange={(e) => setTextSize(Number(e.target.value) || 12)} />
                </>
              )}
              {(tool === "rect" || tool === "pen") && (
                <>
                  <label>Line width</label>
                  <input type="number" min={0.5} max={30} step={0.5} value={lineWidth} onChange={(e) => setLineWidth(Number(e.target.value) || 1)} />
                </>
              )}
            </>
          )}
          {!selected && (tool === "select" || tool === "edit") && (
            <p className="pdfed-note">
              {tool === "edit"
                ? "Click a line of text on the page to change it. The old text is covered and replaced. Scanned pages have no real text, so use Whiteout and Add text instead."
                : "Pick a tool above, or click something on the page to change it."}
            </p>
          )}
          {selected?.kind === "text" && (
            <>
              <label>Text</label>
              <textarea autoFocus rows={4} value={selected.text} onChange={(e) => updateSelected({ text: e.target.value })} onFocus={(e) => e.target.select()} dir="auto" />
              <label>Text size</label>
              <input type="number" min={4} max={200} value={selected.size} onChange={(e) => updateSelected({ size: Number(e.target.value) || 12 })} />
              <label className="pdfed-inline">
                <input type="checkbox" checked={selected.bold} onChange={(e) => updateSelected({ bold: e.target.checked })} /> Bold
              </label>
              <label className="pdfed-inline">
                <input type="checkbox" checked={selected.italic} onChange={(e) => updateSelected({ italic: e.target.checked })} /> Italic
              </label>
              <label className="pdfed-inline">
                <input type="checkbox" checked={selected.serif} onChange={(e) => updateSelected({ serif: e.target.checked })} /> Serif font
              </label>
            </>
          )}
          {selected && selected.kind !== "image" && (
            <>
              <label>Colour</label>
              <input type="color" value={selected.color} onChange={(e) => updateSelected({ color: e.target.value })} />
            </>
          )}
          {selected && (selected.kind === "rect" || selected.kind === "pen") && (
            <>
              <label>Line width</label>
              <input type="number" min={0.5} max={30} step={0.5} value={selected.width} onChange={(e) => updateSelected({ width: Number(e.target.value) || 1 })} />
            </>
          )}
          {selected && (
            <button type="button" className="danger" onClick={deleteSelected}>
              Delete
            </button>
          )}
        </div>
      </div>

      <input ref={openRef} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => onFiles(e, false)} />
      <input ref={mergeRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => onFiles(e, true)} />
      <input ref={imageRef} type="file" accept="image/*" hidden onChange={onImageFile} />
      {signing && (
        <SignaturePad
          onCancel={() => setSigning(false)}
          onDone={(dataUrl) => {
            setSigning(false);
            void placeImage(dataUrl);
          }}
        />
      )}
    </div>
  );
}

function SignaturePad({ onCancel, onDone }: { onCancel: () => void; onDone: (dataUrl: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  const drawing = useRef(false);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * ref.current!.width, y: ((e.clientY - r.top) / r.height) * ref.current!.height };
  };

  function finish() {
    // Crop the transparent margin so the signature sits tightly where it is placed.
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    let minX = width, minY = height, maxX = 0, maxY = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (data[(y * width + x) * 4 + 3] > 0) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
    const out = document.createElement("canvas");
    out.width = maxX - minX + 8;
    out.height = maxY - minY + 8;
    out.getContext("2d")!.drawImage(c, minX - 4, minY - 4, out.width, out.height, 0, 0, out.width, out.height);
    onDone(out.toDataURL("image/png"));
  }

  return (
    <div className="chat-modal-backdrop" onClick={onCancel}>
      <div className="chat-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <h3>Draw your signature</h3>
        <canvas
          ref={ref}
          width={900}
          height={300}
          className="pdfed-sigpad"
          onPointerDown={(e) => {
            drawing.current = true;
            const p = pos(e);
            const ctx = ref.current!.getContext("2d")!;
            ctx.lineWidth = 5;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.strokeStyle = "#111";
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x + 0.1, p.y);
            ctx.stroke();
            setDrawn(true);
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const p = pos(e);
            const ctx = ref.current!.getContext("2d")!;
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
          }}
          onPointerUp={() => (drawing.current = false)}
        />
        <div className="form-row" style={{ justifyContent: "space-between", marginTop: 12 }}>
          <button type="button" className="secondary" onClick={() => { ref.current!.getContext("2d")!.clearRect(0, 0, 900, 300); setDrawn(false); }}>
            Clear
          </button>
          <span>
            <button type="button" className="secondary" onClick={onCancel}>
              Cancel
            </button>{" "}
            <button type="button" disabled={!drawn} onClick={finish}>
              Place on page
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
