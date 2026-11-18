import { ReactNode, useEffect, useRef, useState } from "react";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import {
  baseName,
  canvasToBlob,
  openPdf,
  pageGeometry,
  parseRange,
  parseRangeGroups,
  pdfBlob,
  readBytes,
  renderPageToCanvas,
} from "./engine";
import { FileTool, ToolResult } from "./ui";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="pt-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

async function loadDoc(file: File) {
  try {
    return await PDFDocument.load(await readBytes(file));
  } catch {
    throw new Error(`${file.name} could not be read. It may be password-protected or damaged.`);
  }
}

const outName = (file: File, suffix: string) => `${baseName(file.name)}${suffix}.pdf`;

async function copyPagesInto(src: PDFDocument, indexes: number[]) {
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indexes);
  pages.forEach((p) => out.addPage(p));
  return out;
}

// ── Merge ───────────────────────────────────────────────────────────────
export function MergeTool() {
  return (
    <FileTool
      toolId="merge"
      kind="pdf"
      multiple
      minFiles={2}
      action="Merge PDF"
      run={async ({ files }, progress) => {
        const out = await PDFDocument.create();
        for (let i = 0; i < files.length; i++) {
          progress(`Merging ${i + 1} of ${files.length}…`);
          const doc = await loadDoc(files[i]);
          (await out.copyPages(doc, doc.getPageIndices())).forEach((p) => out.addPage(p));
        }
        return [{ blob: pdfBlob(await out.save()), filename: "merged.pdf" }];
      }}
    />
  );
}

// ── Split ───────────────────────────────────────────────────────────────
export function SplitTool() {
  const [mode, setMode] = useState<"ranges" | "every" | "all">("ranges");
  const [ranges, setRanges] = useState("1-3, 4-");
  const [every, setEvery] = useState(1);
  return (
    <FileTool
      toolId="split"
      kind="pdf"
      action="Split PDF"
      options={({ pages }) => (
        <>
          <div className="pt-seg">
            <button type="button" className={mode === "ranges" ? "on" : ""} onClick={() => setMode("ranges")}>By page ranges</button>
            <button type="button" className={mode === "every" ? "on" : ""} onClick={() => setMode("every")}>Every N pages</button>
            <button type="button" className={mode === "all" ? "on" : ""} onClick={() => setMode("all")}>Every page separately</button>
          </div>
          {mode === "ranges" && (
            <Field label="Page ranges" hint={`Each comma-separated part becomes its own PDF. The document has ${pages[0] || "?"} pages.`}>
              <input value={ranges} onChange={(e) => setRanges(e.target.value)} placeholder="1-3, 4-6, 7-" />
            </Field>
          )}
          {mode === "every" && (
            <Field label="Pages per file">
              <input type="number" min={1} value={every} onChange={(e) => setEvery(Math.max(1, Number(e.target.value) || 1))} />
            </Field>
          )}
        </>
      )}
      run={async ({ files }, progress) => {
        const file = files[0];
        const src = await loadDoc(file);
        const total = src.getPageCount();
        let groups: number[][];
        if (mode === "ranges") groups = parseRangeGroups(ranges, total);
        else if (mode === "every") {
          groups = [];
          for (let i = 1; i <= total; i += every) groups.push(Array.from({ length: Math.min(every, total - i + 1) }, (_, k) => i + k));
        } else groups = Array.from({ length: total }, (_, i) => [i + 1]);
        const results: ToolResult[] = [];
        for (let g = 0; g < groups.length; g++) {
          progress(`Creating file ${g + 1} of ${groups.length}…`);
          const out = await copyPagesInto(src, groups[g].map((n) => n - 1));
          const label = groups[g].length === 1 ? `page-${groups[g][0]}` : `pages-${groups[g][0]}-${groups[g][groups[g].length - 1]}`;
          results.push({ blob: pdfBlob(await out.save()), filename: `${baseName(file.name)}-${label}.pdf` });
        }
        return results;
      }}
    />
  );
}

// ── Remove pages ────────────────────────────────────────────────────────
export function RemovePagesTool() {
  const [pagesText, setPagesText] = useState("");
  return (
    <FileTool
      toolId="remove-pages"
      kind="pdf"
      action="Remove pages"
      options={({ pages }) => (
        <Field label="Pages to remove" hint={`For example 2, 5-7. The document has ${pages[0] || "?"} pages.`}>
          <input value={pagesText} onChange={(e) => setPagesText(e.target.value)} placeholder="2, 5-7" />
        </Field>
      )}
      run={async ({ files }) => {
        const src = await loadDoc(files[0]);
        const total = src.getPageCount();
        const drop = new Set(parseRange(pagesText, total));
        const keep = src.getPageIndices().filter((i) => !drop.has(i + 1));
        if (keep.length === 0) throw new Error("That would remove every page. Keep at least one.");
        const out = await copyPagesInto(src, keep);
        return [{ blob: pdfBlob(await out.save()), filename: outName(files[0], "-removed"), note: `${drop.size} page${drop.size === 1 ? "" : "s"} removed, ${keep.length} left.` }];
      }}
    />
  );
}

// ── Extract pages ───────────────────────────────────────────────────────
export function ExtractPagesTool() {
  const [pagesText, setPagesText] = useState("");
  const [separate, setSeparate] = useState(false);
  return (
    <FileTool
      toolId="extract-pages"
      kind="pdf"
      action="Extract pages"
      options={({ pages }) => (
        <>
          <Field label="Pages to extract" hint={`For example 1-3, 8. The document has ${pages[0] || "?"} pages.`}>
            <input value={pagesText} onChange={(e) => setPagesText(e.target.value)} placeholder="1-3, 8" />
          </Field>
          <label className="pt-check">
            <input type="checkbox" checked={separate} onChange={(e) => setSeparate(e.target.checked)} /> Save each page as a separate PDF
          </label>
        </>
      )}
      run={async ({ files }) => {
        const file = files[0];
        const src = await loadDoc(file);
        const picked = parseRange(pagesText, src.getPageCount());
        if (separate) {
          const results: ToolResult[] = [];
          for (const n of picked) results.push({ blob: pdfBlob(await (await copyPagesInto(src, [n - 1])).save()), filename: `${baseName(file.name)}-page-${n}.pdf` });
          return results;
        }
        const out = await copyPagesInto(src, picked.map((n) => n - 1));
        return [{ blob: pdfBlob(await out.save()), filename: outName(file, "-extracted"), note: `${picked.length} page${picked.length === 1 ? "" : "s"} extracted.` }];
      }}
    />
  );
}

// ── Rotate ──────────────────────────────────────────────────────────────
export function RotateTool() {
  const [angle, setAngle] = useState(90);
  const [which, setWhich] = useState("");
  return (
    <FileTool
      toolId="rotate"
      kind="pdf"
      action="Rotate PDF"
      options={({ pages }) => (
        <>
          <div className="pt-seg">
            {[
              [90, "Right 90°"],
              [180, "Upside down"],
              [270, "Left 90°"],
            ].map(([v, l]) => (
              <button key={v} type="button" className={angle === v ? "on" : ""} onClick={() => setAngle(Number(v))}>
                {l}
              </button>
            ))}
          </div>
          <Field label="Pages" hint={`Leave empty to rotate all ${pages[0] || ""} pages, or enter e.g. 1, 3-5.`}>
            <input value={which} onChange={(e) => setWhich(e.target.value)} placeholder="All pages" />
          </Field>
        </>
      )}
      run={async ({ files }) => {
        const doc = await loadDoc(files[0]);
        const total = doc.getPageCount();
        const targets = which.trim() ? new Set(parseRange(which, total)) : new Set(doc.getPageIndices().map((i) => i + 1));
        doc.getPages().forEach((p, i) => {
          if (targets.has(i + 1)) p.setRotation(degrees((p.getRotation().angle + angle) % 360));
        });
        return [{ blob: pdfBlob(await doc.save()), filename: outName(files[0], "-rotated"), note: `${targets.size} page${targets.size === 1 ? "" : "s"} rotated.` }];
      }}
    />
  );
}

// ── Page numbers ────────────────────────────────────────────────────────
export function PageNumbersTool() {
  const [pos, setPos] = useState("bottom-center");
  const [format, setFormat] = useState("{n}");
  const [start, setStart] = useState(1);
  const [size, setSize] = useState(11);
  const [margin, setMargin] = useState(24);
  const [skipFirst, setSkipFirst] = useState(false);
  return (
    <FileTool
      toolId="page-numbers"
      kind="pdf"
      action="Add page numbers"
      options={() => (
        <div className="pt-grid">
          <Field label="Position">
            <select value={pos} onChange={(e) => setPos(e.target.value)}>
              {["bottom-center", "bottom-right", "bottom-left", "top-center", "top-right", "top-left"].map((p) => (
                <option key={p} value={p}>
                  {p.replace("-", " ")}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Format">
            <select value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="{n}">1, 2, 3</option>
              <option value="Page {n}">Page 1</option>
              <option value="Page {n} of {total}">Page 1 of 10</option>
              <option value="{n} / {total}">1 / 10</option>
              <option value="- {n} -">- 1 -</option>
            </select>
          </Field>
          <Field label="First number">
            <input type="number" value={start} onChange={(e) => setStart(Number(e.target.value) || 1)} />
          </Field>
          <Field label="Font size">
            <input type="number" min={6} max={40} value={size} onChange={(e) => setSize(Number(e.target.value) || 11)} />
          </Field>
          <Field label="Margin (pt)">
            <input type="number" min={0} max={200} value={margin} onChange={(e) => setMargin(Number(e.target.value) || 0)} />
          </Field>
          <label className="pt-check">
            <input type="checkbox" checked={skipFirst} onChange={(e) => setSkipFirst(e.target.checked)} /> Don't number the first page
          </label>
        </div>
      )}
      run={async ({ files }) => {
        const bytes = await readBytes(files[0]);
        const doc = await loadDoc(files[0]);
        const geo = await pageGeometry(await openPdf(bytes, files[0].name));
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const pages = doc.getPages();
        pages.forEach((page, i) => {
          if (skipFirst && i === 0) return;
          const n = start + (skipFirst ? i - 1 : i);
          const label = format.replace("{n}", String(n)).replace("{total}", String(start + pages.length - 1 - (skipFirst ? 1 : 0)));
          const g = geo[i];
          const tw = font.widthOfTextAtSize(label, size);
          const x = pos.endsWith("left") ? margin : pos.endsWith("right") ? g.width - margin - tw : (g.width - tw) / 2;
          const y = pos.startsWith("top") ? margin + size * 0.8 : g.height - margin;
          const [ux, uy] = g.toUser(x, y);
          page.drawText(label, { x: ux, y: uy, size, font, color: rgb(0.1, 0.1, 0.1), rotate: degrees(g.rotation) });
        });
        return [{ blob: pdfBlob(await doc.save()), filename: outName(files[0], "-numbered") }];
      }}
    />
  );
}

// ── Watermark ───────────────────────────────────────────────────────────
const hex = (c: string) => {
  const n = parseInt(c.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

export function WatermarkTool() {
  const [kind, setKind] = useState<"text" | "image">("text");
  const [text, setText] = useState("CONFIDENTIAL");
  const [size, setSize] = useState(60);
  const [color, setColor] = useState("#b42318");
  const [opacity, setOpacity] = useState(25);
  const [angle, setAngle] = useState(45);
  const [layout, setLayout] = useState<"center" | "tile">("center");
  const [image, setImage] = useState<File | null>(null);
  const [imgPct, setImgPct] = useState(40);
  return (
    <FileTool
      toolId="watermark"
      kind="pdf"
      action="Add watermark"
      options={() => (
        <>
          <div className="pt-seg">
            <button type="button" className={kind === "text" ? "on" : ""} onClick={() => setKind("text")}>Text</button>
            <button type="button" className={kind === "image" ? "on" : ""} onClick={() => setKind("image")}>Image</button>
          </div>
          {kind === "text" ? (
            <div className="pt-grid">
              <Field label="Text">
                <input value={text} onChange={(e) => setText(e.target.value)} />
              </Field>
              <Field label="Font size">
                <input type="number" min={8} max={300} value={size} onChange={(e) => setSize(Number(e.target.value) || 40)} />
              </Field>
              <Field label="Colour">
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
              </Field>
            </div>
          ) : (
            <div className="pt-grid">
              <Field label="Image (PNG or JPG)">
                <input type="file" accept="image/png,image/jpeg" onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
              </Field>
              <Field label="Width (% of page)">
                <input type="number" min={5} max={100} value={imgPct} onChange={(e) => setImgPct(Number(e.target.value) || 40)} />
              </Field>
            </div>
          )}
          <div className="pt-grid">
            <Field label={`Opacity: ${opacity}%`}>
              <input type="range" min={5} max={100} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
            </Field>
            <Field label="Rotation">
              <select value={angle} onChange={(e) => setAngle(Number(e.target.value))}>
                <option value={0}>None</option>
                <option value={45}>Diagonal (45°)</option>
                <option value={90}>Vertical (90°)</option>
              </select>
            </Field>
            <Field label="Layout">
              <select value={layout} onChange={(e) => setLayout(e.target.value as "center" | "tile")}>
                <option value="center">One in the centre</option>
                <option value="tile">Repeat across the page</option>
              </select>
            </Field>
          </div>
        </>
      )}
      validate={() => (kind === "text" && !text.trim() ? "Enter the watermark text." : kind === "image" && !image ? "Choose a watermark image." : null)}
      run={async ({ files }) => {
        const bytes = await readBytes(files[0]);
        const doc = await loadDoc(files[0]);
        const geo = await pageGeometry(await openPdf(bytes, files[0].name));
        const font = await doc.embedFont(StandardFonts.HelveticaBold);
        let img: Awaited<ReturnType<PDFDocument["embedPng"]>> | null = null;
        if (kind === "image" && image) {
          const ib = await readBytes(image);
          img = image.type === "image/jpeg" ? await doc.embedJpg(ib) : await doc.embedPng(ib);
        }
        const op = opacity / 100;
        doc.getPages().forEach((page, i) => {
          const g = geo[i];
          // Size of one stamp.
          let tw: number;
          let th: number;
          if (img) {
            tw = (g.width * imgPct) / 100;
            th = (img.height / img.width) * tw;
          } else {
            tw = font.widthOfTextAtSize(text, size);
            th = size;
          }
          const theta = ((g.rotation + angle) * Math.PI) / 180;
          const cos = Math.cos(theta);
          const sin = Math.sin(theta);
          const place = (cx: number, cy: number) => {
            const [ux, uy] = g.toUser(cx, cy);
            // Anchor (bottom-left of the stamp) so that its middle lands on the point.
            const a = tw / 2;
            const b = img ? th / 2 : th * 0.3;
            const ax = ux - (a * cos - b * sin);
            const ay = uy - (a * sin + b * cos);
            if (img) page.drawImage(img, { x: ax, y: ay, width: tw, height: th, rotate: degrees(g.rotation + angle), opacity: op });
            else page.drawText(text, { x: ax, y: ay, size, font, color: hex(color), rotate: degrees(g.rotation + angle), opacity: op });
          };
          if (layout === "center") place(g.width / 2, g.height / 2);
          else {
            const stepX = tw * 1.5;
            const stepY = th * 3;
            for (let y = stepY / 2; y < g.height + stepY; y += stepY) for (let x = stepX / 2; x < g.width + stepX; x += stepX) place(x, y);
          }
        });
        return [{ blob: pdfBlob(await doc.save()), filename: outName(files[0], "-watermarked") }];
      }}
    />
  );
}

// ── Crop ────────────────────────────────────────────────────────────────
const MM = 72 / 25.4;

function CropPreview({ file, m }: { file: File; m: { t: number; b: number; l: number; r: number } }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const pdf = await openPdf(await readBytes(file), file.name);
      const canvas = await renderPageToCanvas(pdf, 1, 0.5);
      if (!alive || !ref.current) return;
      ref.current.width = canvas.width;
      ref.current.height = canvas.height;
      ref.current.getContext("2d")!.drawImage(canvas, 0, 0);
      const base = await pdf.getPage(1);
      const vp = base.getViewport({ scale: 1 });
      setSize({ w: vp.width, h: vp.height });
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [file]);
  const pct = (mm: number, total: number) => (size ? Math.min(100, ((mm * MM) / total) * 100) : 0);
  return (
    <div className="pt-crop-preview">
      <canvas ref={ref} />
      {size && (
        <>
          <div className="shade" style={{ left: 0, right: 0, top: 0, height: `${pct(m.t, size.h)}%` }} />
          <div className="shade" style={{ left: 0, right: 0, bottom: 0, height: `${pct(m.b, size.h)}%` }} />
          <div className="shade" style={{ left: 0, top: 0, bottom: 0, width: `${pct(m.l, size.w)}%` }} />
          <div className="shade" style={{ right: 0, top: 0, bottom: 0, width: `${pct(m.r, size.w)}%` }} />
        </>
      )}
    </div>
  );
}

export function CropTool() {
  const [m, setM] = useState({ t: 10, b: 10, l: 10, r: 10 });
  const num = (k: "t" | "b" | "l" | "r") => (
    <input type="number" min={0} value={m[k]} onChange={(e) => setM({ ...m, [k]: Math.max(0, Number(e.target.value) || 0) })} />
  );
  return (
    <FileTool
      toolId="crop"
      kind="pdf"
      action="Crop PDF"
      options={({ files }) => (
        <div className="pt-crop">
          <div className="pt-grid">
            <Field label="Top (mm)">{num("t")}</Field>
            <Field label="Bottom (mm)">{num("b")}</Field>
            <Field label="Left (mm)">{num("l")}</Field>
            <Field label="Right (mm)">{num("r")}</Field>
          </div>
          {files[0] && <CropPreview file={files[0]} m={m} />}
          <small>The shaded area is removed from every page.</small>
        </div>
      )}
      run={async ({ files }) => {
        const bytes = await readBytes(files[0]);
        const doc = await loadDoc(files[0]);
        const geo = await pageGeometry(await openPdf(bytes, files[0].name));
        doc.getPages().forEach((page, i) => {
          const g = geo[i];
          const [x1, y1] = g.toUser(m.l * MM, m.t * MM);
          const [x2, y2] = g.toUser(g.width - m.r * MM, g.height - m.b * MM);
          const x = Math.min(x1, x2);
          const y = Math.min(y1, y2);
          const w = Math.abs(x2 - x1);
          const h = Math.abs(y2 - y1);
          if (w < 10 || h < 10) throw new Error("Those margins leave nothing of the page.");
          page.setCropBox(x, y, w, h);
          page.setMediaBox(x, y, w, h);
        });
        return [{ blob: pdfBlob(await doc.save()), filename: outName(files[0], "-cropped") }];
      }}
    />
  );
}

// ── Compress ────────────────────────────────────────────────────────────
export function CompressTool() {
  const [level, setLevel] = useState<"light" | "recommended" | "extreme">("recommended");
  return (
    <FileTool
      toolId="compress"
      kind="pdf"
      action="Compress PDF"
      options={() => (
        <div className="pt-levels">
          {[
            ["light", "Light", "Keeps text and quality. Small saving."],
            ["recommended", "Recommended", "Good quality, much smaller. Pages become images."],
            ["extreme", "Extreme", "Smallest file, lower quality. Pages become images."],
          ].map(([v, t, d]) => (
            <button key={v} type="button" className={level === v ? "on" : ""} onClick={() => setLevel(v as typeof level)}>
              <strong>{t}</strong>
              <span>{d}</span>
            </button>
          ))}
        </div>
      )}
      run={async ({ files }, progress) => {
        const file = files[0];
        const bytes = await readBytes(file);
        let out: Uint8Array;
        if (level === "light") {
          const doc = await loadDoc(file);
          doc.setTitle("");
          doc.setProducer("");
          out = await doc.save({ useObjectStreams: true });
        } else {
          const pdf = await openPdf(bytes, file.name);
          const doc = await PDFDocument.create();
          const scale = level === "recommended" ? 1.6 : 1.05;
          const quality = level === "recommended" ? 0.72 : 0.5;
          for (let i = 1; i <= pdf.numPages; i++) {
            progress(`Compressing page ${i} of ${pdf.numPages}…`);
            const page = await pdf.getPage(i);
            const vp = page.getViewport({ scale: 1 });
            const canvas = await renderPageToCanvas(pdf, i, scale);
            const img = await doc.embedJpg(await readBytes(await canvasToBlob(canvas, "image/jpeg", quality)));
            doc.addPage([vp.width, vp.height]).drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
            canvas.width = canvas.height = 0;
          }
          out = await doc.save();
        }
        if (out.length >= bytes.length) {
          return [{ blob: pdfBlob(bytes), filename: outName(file, "-compressed"), note: "This PDF is already as small as it can get at this level, so it was left unchanged." }];
        }
        const saved = Math.round((1 - out.length / bytes.length) * 100);
        return [{ blob: pdfBlob(out), filename: outName(file, "-compressed"), note: `${saved}% smaller.` }];
      }}
    />
  );
}

// ── Repair ──────────────────────────────────────────────────────────────
export function RepairTool() {
  return (
    <FileTool
      toolId="repair"
      kind="pdf"
      action="Repair PDF"
      run={async ({ files }, progress) => {
        const file = files[0];
        const bytes = await readBytes(file);
        try {
          const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
          if (doc.getPageCount() === 0) throw new Error("no pages");
          return [{ blob: pdfBlob(await doc.save()), filename: outName(file, "-repaired"), note: "The document structure was rebuilt." }];
        } catch {
          // The structure is too damaged to rebuild: re-draw every readable page instead.
          progress("Rebuilding page by page…");
          const pdf = await openPdf(bytes, file.name);
          const doc = await PDFDocument.create();
          let ok = 0;
          for (let i = 1; i <= pdf.numPages; i++) {
            try {
              const vp = (await pdf.getPage(i)).getViewport({ scale: 1 });
              const canvas = await renderPageToCanvas(pdf, i, 2);
              const img = await doc.embedJpg(await readBytes(await canvasToBlob(canvas, "image/jpeg", 0.9)));
              doc.addPage([vp.width, vp.height]).drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
              ok++;
            } catch {
              /* skip an unreadable page */
            }
          }
          if (ok === 0) throw new Error("This file is too damaged to recover.");
          return [{ blob: pdfBlob(await doc.save()), filename: outName(file, "-repaired"), note: `Recovered ${ok} of ${pdf.numPages} pages as images (text is no longer selectable).` }];
        }
      }}
    />
  );
}
