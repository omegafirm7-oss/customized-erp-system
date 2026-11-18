import { PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import fontkit from "@pdf-lib/fontkit";
import { PDFCheckBox, PDFDocument, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFTextField, StandardFonts, rgb } from "pdf-lib";
import { PDFDocumentProxy, baseName, formatBytes, openPdf, pdfBlob, readBytes, saveBlob } from "./engine";
import { toolById } from "./catalog";

type Kind = "text" | "checkbox" | "radio" | "dropdown" | "list";
type DrawType = null | "text" | "multiline" | "checkbox" | "dropdown";

interface Widget {
  page: number;
  /** PDF user-space rectangle. */
  rect: { x: number; y: number; w: number; h: number };
  /** For radio buttons: the choice this circle stands for. */
  option?: string;
}

interface FormField {
  id: string;
  name: string;
  kind: Kind;
  multiline: boolean;
  options: string[];
  widgets: Widget[];
  value: string | boolean | string[];
  readOnly: boolean;
  isNew: boolean;
}

let idCounter = 0;
const newId = () => `f${++idCounter}`;

/** Reads the existing form fields of a PDF, with where each one sits on its page. */
async function readFields(bytes: Uint8Array): Promise<FormField[]> {
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();
  const pages = doc.getPages();
  const annotPage = new Map<string, number>();
  pages.forEach((p, i) => {
    const annots = p.node.Annots();
    if (annots) for (const a of annots.asArray()) annotPage.set(String(a), i);
  });
  const fields: FormField[] = [];
  for (const field of form.getFields()) {
    let kind: Kind | null = null;
    if (field instanceof PDFTextField) kind = "text";
    else if (field instanceof PDFCheckBox) kind = "checkbox";
    else if (field instanceof PDFRadioGroup) kind = "radio";
    else if (field instanceof PDFDropdown) kind = "dropdown";
    else if (field instanceof PDFOptionList) kind = "list";
    if (!kind) continue; // buttons and signature fields can't be filled here
    const widgets: Widget[] = [];
    for (const w of field.acroField.getWidgets()) {
      const ref = doc.context.getObjectRef(w.dict);
      let page = ref ? annotPage.get(String(ref)) : undefined;
      if (page === undefined) {
        const p = w.P();
        page = p ? pages.findIndex((pg) => pg.ref === p) : -1;
      }
      if (page === undefined || page < 0) continue;
      const r = w.getRectangle();
      let option: string | undefined;
      if (field instanceof PDFRadioGroup) {
        // Some forms store the choice as a position in the field's option list rather than its label.
        const on = w.getOnValue()?.decodeText() ?? "";
        const opts = field.getOptions();
        option = opts.includes(on) ? on : (opts[Number(on)] ?? on);
      }
      widgets.push({ page, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, option });
    }
    let value: FormField["value"] = "";
    try {
      if (field instanceof PDFTextField) value = field.getText() ?? "";
      else if (field instanceof PDFCheckBox) value = field.isChecked();
      else if (field instanceof PDFRadioGroup) value = field.getSelected() ?? "";
      else if (field instanceof PDFDropdown) value = field.getSelected()[0] ?? "";
      else if (field instanceof PDFOptionList) value = field.getSelected();
    } catch {
      /* some rich-text values can't be read; start empty */
    }
    fields.push({
      id: newId(),
      name: field.getName(),
      kind,
      multiline: field instanceof PDFTextField ? field.isMultiline() : false,
      options: field instanceof PDFRadioGroup || field instanceof PDFDropdown || field instanceof PDFOptionList ? field.getOptions() : [],
      widgets,
      value,
      readOnly: field.isReadOnly(),
      isNew: false,
    });
  }
  return fields;
}

const isLatin = (s: string) => /^[\x20-\x7E\xA0-\xFF\n\r\t]*$/.test(s);

/** Writes the answers (and any new fields) into the PDF. */
async function buildPdf(bytes: Uint8Array, fields: FormField[], flatten: boolean): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  doc.registerFontkit(fontkit);
  const form = doc.getForm();
  const pages = doc.getPages();
  const taken = new Set(form.getFields().map((f) => f.getName()));
  let needsUnicode = false;

  for (const f of fields) {
    if (!f.isNew) {
      const field = form.getField(f.name);
      if (field instanceof PDFTextField) {
        const v = String(f.value);
        if (!isLatin(v)) needsUnicode = true;
        if (v) field.setText(v);
        else field.setText(undefined);
      } else if (field instanceof PDFCheckBox) {
        if (f.value) field.check();
        else field.uncheck();
      } else if (field instanceof PDFRadioGroup) {
        if (f.value) field.select(String(f.value));
        else field.clear();
      } else if (field instanceof PDFDropdown) {
        if (f.value) field.select(String(f.value));
        else field.clear();
      } else if (field instanceof PDFOptionList) {
        const sel = f.value as string[];
        if (sel.length) field.select(sel);
        else field.clear();
      }
      continue;
    }
    // A field drawn by the user.
    let name = (f.name || "Field").trim() || "Field";
    while (taken.has(name)) name += "_";
    taken.add(name);
    const w = f.widgets[0];
    const page = pages[w.page];
    const box = { x: w.rect.x, y: w.rect.y, width: w.rect.w, height: w.rect.h, borderWidth: 1, borderColor: rgb(0.25, 0.32, 0.7), backgroundColor: rgb(0.95, 0.96, 1) };
    if (f.kind === "text") {
      const t = form.createTextField(name);
      if (f.multiline) t.enableMultiline();
      const v = String(f.value);
      if (!isLatin(v)) needsUnicode = true;
      if (v) t.setText(v);
      t.addToPage(page, box);
    } else if (f.kind === "checkbox") {
      const side = Math.min(w.rect.w, w.rect.h);
      const c = form.createCheckBox(name);
      c.addToPage(page, { ...box, width: side, height: side });
      if (f.value) c.check();
    } else if (f.kind === "dropdown") {
      const d = form.createDropdown(name);
      const opts = f.options.filter((o) => o.trim());
      if (opts.some((o) => !isLatin(o))) needsUnicode = true;
      d.addOptions(opts.length ? opts : ["Option 1"]);
      d.addToPage(page, box);
      if (f.value && opts.includes(String(f.value))) d.select(String(f.value));
    }
  }

  const font = needsUnicode
    ? await doc.embedFont(new Uint8Array(await (await fetch("/ocr/fonts/DejaVuSans.ttf")).arrayBuffer()), { subset: true })
    : await doc.embedFont(StandardFonts.Helvetica);
  form.updateFieldAppearances(font);
  if (flatten) form.flatten({ updateFieldAppearances: false });
  return doc.save();
}

// ── Page with its fields on top ────────────────────────────────────────

interface PageProps {
  pdf: PDFDocumentProxy;
  pageIndex: number;
  fields: FormField[];
  drawType: DrawType;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onValue: (id: string, value: FormField["value"]) => void;
  onDraw: (pageIndex: number, rect: { x: number; y: number; w: number; h: number }) => void;
}

function FormPage({ pdf, pageIndex, fields, drawType, selectedId, onSelect, onValue, onDraw }: PageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const holderRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState<{ viewport: any; scale: number } | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  useEffect(() => {
    let alive = true;
    let task: { cancel: () => void } | null = null;
    (async () => {
      const page = await pdf.getPage(pageIndex + 1);
      const base = page.getViewport({ scale: 1 });
      const avail = Math.min(holderRef.current?.clientWidth ?? 760, 860);
      const scale = Math.max(0.4, Math.min(2, avail / base.width));
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas || !alive) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.ceil(viewport.width * dpr);
      canvas.height = Math.ceil(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const hi = page.getViewport({ scale: scale * dpr });
      const t = page.render({ canvasContext: ctx, viewport: hi });
      task = t;
      t.promise.catch(() => undefined);
      if (alive) setVp({ viewport, scale });
    })();
    return () => {
      alive = false;
      task?.cancel();
    };
  }, [pdf, pageIndex]);

  /** PDF user-space rectangle -> on-screen box. */
  const toScreen = (r: Widget["rect"]) => {
    const v = vp!.viewport;
    const [x1, y1] = v.convertToViewportPoint(r.x, r.y);
    const [x2, y2] = v.convertToViewportPoint(r.x + r.w, r.y + r.h);
    return { left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
  };

  function down(e: ReactPointerEvent) {
    if (!drawType || !vp || e.target !== overlayRef.current) return;
    e.preventDefault();
    const box = overlayRef.current!.getBoundingClientRect();
    const sx = e.clientX - box.left;
    const sy = e.clientY - box.top;
    let cur = { x: sx, y: sy, w: 0, h: 0 };
    const move = (ev: PointerEvent) => {
      const x = ev.clientX - box.left;
      const y = ev.clientY - box.top;
      cur = { x: Math.min(sx, x), y: Math.min(sy, y), w: Math.abs(x - sx), h: Math.abs(y - sy) };
      setDrag(cur);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (cur.w < 8 || cur.h < 8) return;
      const v = vp.viewport;
      const [ux1, uy1] = v.convertToPdfPoint(cur.x, cur.y);
      const [ux2, uy2] = v.convertToPdfPoint(cur.x + cur.w, cur.y + cur.h);
      onDraw(pageIndex, { x: Math.min(ux1, ux2), y: Math.min(uy1, uy2), w: Math.abs(ux2 - ux1), h: Math.abs(uy2 - uy1) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div ref={holderRef} className="pt-forms-page-holder">
      <div className="pt-forms-page" style={{ width: vp?.viewport.width, height: vp?.viewport.height }}>
        <canvas ref={canvasRef} />
        <div ref={overlayRef} className="pt-forms-overlay" style={{ cursor: drawType ? "crosshair" : "default" }} onPointerDown={down}>
          {vp &&
            fields.flatMap((f) =>
              f.widgets
                .filter((w) => w.page === pageIndex)
                .map((w, i) => {
                  const b = toScreen(w.rect);
                  const style = { left: b.left, top: b.top, width: b.width, height: b.height, pointerEvents: drawType ? ("none" as const) : ("auto" as const) };
                  const cls = `pt-wi ${f.id === selectedId ? "sel" : ""} ${f.isNew ? "new" : ""}`;
                  const fontSize = Math.max(8, Math.min(15, b.height * 0.62));
                  if (f.kind === "text") {
                    return f.multiline ? (
                      <textarea key={f.id + i} className={cls} style={{ ...style, fontSize }} value={String(f.value)} disabled={f.readOnly} onFocus={() => onSelect(f.id)} onChange={(e) => onValue(f.id, e.target.value)} />
                    ) : (
                      <input key={f.id + i} className={cls} style={{ ...style, fontSize }} value={String(f.value)} disabled={f.readOnly} onFocus={() => onSelect(f.id)} onChange={(e) => onValue(f.id, e.target.value)} />
                    );
                  }
                  if (f.kind === "checkbox") {
                    return (
                      <label key={f.id + i} className={cls + " pt-wi-box"} style={style}>
                        <input type="checkbox" checked={!!f.value} disabled={f.readOnly} onFocus={() => onSelect(f.id)} onChange={(e) => onValue(f.id, e.target.checked)} />
                      </label>
                    );
                  }
                  if (f.kind === "radio") {
                    return (
                      <label key={f.id + i} className={cls + " pt-wi-box"} style={style}>
                        <input type="radio" name={f.id} checked={f.value === w.option} disabled={f.readOnly} onFocus={() => onSelect(f.id)} onChange={() => onValue(f.id, w.option ?? "")} />
                      </label>
                    );
                  }
                  if (f.kind === "dropdown") {
                    return (
                      <select key={f.id + i} className={cls} style={{ ...style, fontSize }} value={String(f.value)} disabled={f.readOnly} onFocus={() => onSelect(f.id)} onChange={(e) => onValue(f.id, e.target.value)}>
                        <option value=""></option>
                        {f.options.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    );
                  }
                  return (
                    <select key={f.id + i} multiple className={cls} style={{ ...style, fontSize }} value={f.value as string[]} disabled={f.readOnly} onFocus={() => onSelect(f.id)} onChange={(e) => onValue(f.id, Array.from(e.target.selectedOptions, (o) => o.value))}>
                      {f.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  );
                }),
            )}
          {drag && <div className="pt-forms-drag" style={{ left: drag.x, top: drag.y, width: drag.w, height: drag.h }} />}
        </div>
      </div>
    </div>
  );
}

// ── The tool ───────────────────────────────────────────────────────────

export function FormsTool() {
  const tool = toolById("pdf-forms")!;
  const [file, setFile] = useState<File | null>(null);
  const bytesRef = useRef<Uint8Array | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [fields, setFields] = useState<FormField[]>([]);
  const [page, setPage] = useState(0);
  const [drawType, setDrawType] = useState<DrawType>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flatten, setFlatten] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ blob: Blob; filename: string } | null>(null);
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = `${tool.title} | Free PDF tools`;
  }, [tool.title]);

  async function openFile(f: File) {
    setError(null);
    setDone(null);
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") {
      setError("Please choose a PDF file.");
      return;
    }
    try {
      const bytes = await readBytes(f);
      const doc = await openPdf(bytes, f.name);
      const found = await readFields(bytes).catch(() => {
        throw new Error(`${f.name} could not be read as a form. It may be damaged or protected.`);
      });
      bytesRef.current = bytes;
      setFile(f);
      setPdf(doc);
      setFields(found);
      setPage(0);
      setSelectedId(null);
      setDrawType(found.length === 0 ? "text" : null);
    } catch (err: any) {
      setError(err.message);
    }
  }

  const selected = fields.find((f) => f.id === selectedId) ?? null;
  const setValue = (id: string, value: FormField["value"]) => setFields((fs) => fs.map((f) => (f.id === id ? { ...f, value } : f)));
  const patch = (id: string, p: Partial<FormField>) => setFields((fs) => fs.map((f) => (f.id === id ? { ...f, ...p } : f)));

  function addField(pageIndex: number, rect: { x: number; y: number; w: number; h: number }) {
    if (!drawType) return;
    const n = fields.filter((f) => f.isNew).length + 1;
    const f: FormField = {
      id: newId(),
      name: drawType === "checkbox" ? `Checkbox ${n}` : drawType === "dropdown" ? `Dropdown ${n}` : `Text ${n}`,
      kind: drawType === "multiline" ? "text" : drawType,
      multiline: drawType === "multiline",
      options: drawType === "dropdown" ? ["Option 1", "Option 2", "Option 3"] : [],
      widgets: [{ page: pageIndex, rect }],
      value: drawType === "checkbox" ? false : "",
      readOnly: false,
      isNew: true,
    };
    setFields((fs) => [...fs, f]);
    setSelectedId(f.id);
    setDrawType(null);
  }

  async function download() {
    if (!bytesRef.current || !file) return;
    setBusy(true);
    setError(null);
    try {
      const out = await buildPdf(bytesRef.current, fields, flatten);
      const hasNew = fields.some((f) => f.isNew);
      setDone({ blob: pdfBlob(out), filename: `${baseName(file.name)}-${hasNew ? "form" : "filled"}.pdf` });
    } catch (err: any) {
      console.error(err);
      setError(err?.message ? `Could not save the form: ${err.message}` : "Could not save the form.");
    } finally {
      setBusy(false);
    }
  }

  const existing = fields.filter((f) => !f.isNew);
  const added = fields.filter((f) => f.isNew);

  if (!pdf || !file) {
    return (
      <div className="pt-tool">
        <div className="pt-tool-head">
          <h1>{tool.title}</h1>
          <p>Fill in a PDF form, or add text boxes, checkboxes and dropdowns to any PDF to turn it into a fillable form.</p>
        </div>
        <div
          className={`pt-drop ${over ? "over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files[0];
            if (f) void openFile(f);
          }}
        >
          <button type="button" className="pt-big" style={{ background: tool.color }} onClick={() => inputRef.current?.click()}>
            Select PDF file
          </button>
          <p>or drop a file here</p>
        </div>
        {error && <div className="pt-error">{error}</div>}
        <input
          ref={inputRef}
          type="file"
          hidden
          accept="application/pdf,.pdf"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void openFile(f);
          }}
        />
        <p className="pt-privacy">Your files are processed inside your browser and are never uploaded to our servers.</p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="pt-tool">
        <div className="pt-tool-head">
          <h1>{tool.title}</h1>
        </div>
        <div className="pt-result">
          <h2>Done! Your file is ready.</h2>
          <div className="pt-result-row">
            <span className="pt-file-name">{done.filename}</span>
            <span className="pt-file-meta">{formatBytes(done.blob.size)}</span>
            <button type="button" className="pt-big sm" style={{ background: tool.color }} onClick={() => saveBlob(done.blob, done.filename)}>
              Download
            </button>
          </div>
          <button type="button" className="pt-ghost" onClick={() => setDone(null)}>
            Keep editing
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-forms">
      <div className="pt-tool-head" style={{ margin: "6px 0 14px" }}>
        <h1 style={{ fontSize: 28 }}>{tool.title}</h1>
        <p style={{ fontSize: 15 }}>
          {existing.length > 0
            ? `${existing.length} form field${existing.length === 1 ? "" : "s"} found. Click a field on the page and type, or add new fields.`
            : "This PDF has no form fields yet. Draw a box on the page where each field should go."}
        </p>
      </div>
      <div className="pt-forms-bar">
        <span className="pt-forms-label">Add a field:</span>
        {(
          [
            ["text", "Text box"],
            ["multiline", "Multi-line box"],
            ["checkbox", "Checkbox"],
            ["dropdown", "Dropdown"],
          ] as Array<[DrawType, string]>
        ).map(([t, label]) => (
          <button key={t} type="button" className={drawType === t ? "on" : ""} onClick={() => setDrawType(drawType === t ? null : t)}>
            {label}
          </button>
        ))}
        {drawType && <span className="pt-forms-hint">Now drag on the page to draw it.</span>}
        <span style={{ flex: 1 }} />
        <label className="pt-check">
          <input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} /> Lock answers into the page (flatten)
        </label>
        <button type="button" className="pt-big sm" style={{ background: tool.color }} disabled={busy} onClick={download}>
          {busy ? "Saving…" : "Save PDF"}
        </button>
        <button
          type="button"
          className="pt-ghost"
          onClick={() => {
            setPdf(null);
            setFile(null);
            setFields([]);
          }}
        >
          Choose another file
        </button>
      </div>
      {error && <div className="pt-error">{error}</div>}

      <div className="pt-forms-body">
        <div className="pt-forms-view">
          <FormPage pdf={pdf} pageIndex={page} fields={fields} drawType={drawType} selectedId={selectedId} onSelect={setSelectedId} onValue={setValue} onDraw={(p, r) => addField(p, r)} />
          <div className="pt-forms-pager">
            <button type="button" className="pt-ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <span>
              Page {page + 1} of {pdf.numPages}
            </span>
            <button type="button" className="pt-ghost" disabled={page >= pdf.numPages - 1} onClick={() => setPage(page + 1)}>
              Next
            </button>
          </div>
        </div>

        <aside className="pt-forms-side">
          {selected?.isNew && (
            <div className="pt-forms-card">
              <h4>Field settings</h4>
              <label className="pt-field">
                <span>Name</span>
                <input value={selected.name} onChange={(e) => patch(selected.id, { name: e.target.value })} />
              </label>
              {selected.kind === "dropdown" && (
                <label className="pt-field">
                  <span>Choices (one per line)</span>
                  <textarea rows={4} value={selected.options.join("\n")} onChange={(e) => patch(selected.id, { options: e.target.value.split("\n") })} />
                </label>
              )}
              <button
                type="button"
                className="pt-ghost"
                onClick={() => {
                  setFields((fs) => fs.filter((f) => f.id !== selected.id));
                  setSelectedId(null);
                }}
              >
                Delete this field
              </button>
            </div>
          )}
          <div className="pt-forms-card">
            <h4>
              Fields ({fields.length})
            </h4>
            {fields.length === 0 && <p className="pt-hint">None yet.</p>}
            <ul>
              {[...existing, ...added].map((f) => (
                <li key={f.id} className={f.id === selectedId ? "on" : ""}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(f.id);
                      const w = f.widgets[0];
                      if (w) setPage(w.page);
                    }}
                  >
                    {f.name}
                    <small>{f.isNew ? "new" : f.kind}</small>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <p className="pt-hint">Radio buttons and lists in existing forms can be filled. New fields can be text boxes, checkboxes or dropdowns.</p>
        </aside>
      </div>
      <p className="pt-privacy">Your files are processed inside your browser and are never uploaded to our servers.</p>
    </div>
  );
}
