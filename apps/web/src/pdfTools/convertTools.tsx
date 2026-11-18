import { useState } from "react";
import { PDFDocument } from "pdf-lib";
import { baseName, canvasToBlob, formatBytes, openPdf, pageTextLines, parseRange, pdfBlob, readBytes, renderPageToCanvas, TextLine } from "./engine";
import { Field } from "./organizeTools";
import { FileTool, ToolResult } from "./ui";

// ── Images → PDF (JPG to PDF, Scan to PDF) ──────────────────────────────
const A4 = { w: 595.28, h: 841.89 };
const LETTER = { w: 612, h: 792 };

export function ImagesToPdfTool({ scan = false }: { scan?: boolean }) {
  const [size, setSize] = useState<"fit" | "a4" | "letter">(scan ? "a4" : "fit");
  const [orient, setOrient] = useState<"auto" | "portrait" | "landscape">("auto");
  const [margin, setMargin] = useState<0 | 10 | 20>(scan ? 10 : 0);
  return (
    <FileTool
      toolId={scan ? "scan" : "jpg-to-pdf"}
      kind="image"
      multiple
      camera={scan}
      action={scan ? "Create PDF" : "Convert to PDF"}
      options={() => (
        <div className="pt-grid">
          <Field label="Page size">
            <select value={size} onChange={(e) => setSize(e.target.value as typeof size)}>
              <option value="fit">Same as the image</option>
              <option value="a4">A4</option>
              <option value="letter">US Letter</option>
            </select>
          </Field>
          <Field label="Orientation">
            <select value={orient} onChange={(e) => setOrient(e.target.value as typeof orient)}>
              <option value="auto">Automatic</option>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </Field>
          <Field label="Margin">
            <select value={margin} onChange={(e) => setMargin(Number(e.target.value) as typeof margin)}>
              <option value={0}>None</option>
              <option value={10}>Small</option>
              <option value={20}>Big</option>
            </select>
          </Field>
        </div>
      )}
      run={async ({ files }, progress) => {
        const doc = await PDFDocument.create();
        for (let i = 0; i < files.length; i++) {
          progress(`Adding image ${i + 1} of ${files.length}…`);
          const bmp = await createImageBitmap(files[i]);
          const canvas = document.createElement("canvas");
          canvas.width = bmp.width;
          canvas.height = bmp.height;
          const ctx = canvas.getContext("2d")!;
          const png = files[i].type === "image/png";
          if (!png) {
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }
          ctx.drawImage(bmp, 0, 0);
          bmp.close();
          const blob = await canvasToBlob(canvas, png ? "image/png" : "image/jpeg", 0.92);
          const img = png ? await doc.embedPng(await readBytes(blob)) : await doc.embedJpg(await readBytes(blob));
          const iw = img.width * 0.75;
          const ih = img.height * 0.75;
          const m = margin * 2.835;
          let pw: number;
          let ph: number;
          if (size === "fit") {
            pw = iw + m * 2;
            ph = ih + m * 2;
          } else {
            const base = size === "a4" ? A4 : LETTER;
            const landscape = orient === "landscape" || (orient === "auto" && img.width > img.height);
            pw = landscape ? base.h : base.w;
            ph = landscape ? base.w : base.h;
          }
          const k = Math.min((pw - m * 2) / img.width, (ph - m * 2) / img.height, size === "fit" ? 0.75 : Infinity);
          const w = img.width * k;
          const h = img.height * k;
          doc.addPage([pw, ph]).drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
        }
        return [{ blob: pdfBlob(await doc.save()), filename: scan ? "scan.pdf" : "images.pdf" }];
      }}
    />
  );
}

// ── Excel → PDF ─────────────────────────────────────────────────────────
export function ExcelToPdfTool() {
  return (
    <FileTool
      toolId="excel-to-pdf"
      kind="excel"
      action="Convert to PDF"
      run={async ({ files }, progress) => {
        const XLSX = await import("xlsx");
        const { jsPDF } = await import("jspdf");
        const autoTable = (await import("jspdf-autotable")).default;
        const wb = XLSX.read(await files[0].arrayBuffer(), { type: "array", cellDates: true });
        let doc: InstanceType<typeof jsPDF> | null = null;
        for (const name of wb.SheetNames) {
          progress(`Sheet ${name}…`);
          const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: false, defval: "" }) as string[][];
          const data = rows.filter((r) => r.some((c) => String(c).trim() !== ""));
          if (data.length === 0) continue;
          const cols = Math.max(...data.map((r) => r.length));
          const orientation = cols > 6 ? "landscape" : "portrait";
          if (!doc) doc = new jsPDF({ orientation, unit: "pt", format: "a4" });
          else doc.addPage("a4", orientation);
          doc.setFontSize(12);
          doc.text(name, 40, 36);
          autoTable(doc, {
            startY: 48,
            head: [data[0].map(String)],
            body: data.slice(1).map((r) => Array.from({ length: cols }, (_, i) => String(r[i] ?? ""))),
            styles: { fontSize: cols > 10 ? 6 : 8, cellPadding: 3 },
            headStyles: { fillColor: [31, 41, 55] },
            margin: { left: 30, right: 30 },
            horizontalPageBreak: cols > 14,
          });
        }
        if (!doc) throw new Error("That spreadsheet has no data to convert.");
        return [{ blob: doc.output("blob"), filename: `${baseName(files[0].name)}.pdf`, note: "Latin text only: Arabic and other scripts are not supported in this converter." }];
      }}
    />
  );
}

// ── PDF → JPG ───────────────────────────────────────────────────────────
export function PdfToJpgTool() {
  const [dpi, setDpi] = useState(150);
  const [quality, setQuality] = useState(90);
  const [which, setWhich] = useState("");
  return (
    <FileTool
      toolId="pdf-to-jpg"
      kind="pdf"
      action="Convert to JPG"
      options={({ pages }) => (
        <div className="pt-grid">
          <Field label="Resolution">
            <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
              <option value={72}>72 dpi (small)</option>
              <option value={150}>150 dpi (standard)</option>
              <option value={300}>300 dpi (print)</option>
            </select>
          </Field>
          <Field label={`Quality: ${quality}%`}>
            <input type="range" min={40} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
          </Field>
          <Field label="Pages" hint={`Leave empty for all ${pages[0] || ""} pages.`}>
            <input value={which} onChange={(e) => setWhich(e.target.value)} placeholder="All pages" />
          </Field>
        </div>
      )}
      run={async ({ files }, progress) => {
        const pdf = await openPdf(await readBytes(files[0]), files[0].name);
        const list = which.trim() ? parseRange(which, pdf.numPages) : Array.from({ length: pdf.numPages }, (_, i) => i + 1);
        const results: ToolResult[] = [];
        for (const n of list) {
          progress(`Page ${n}…`);
          const canvas = await renderPageToCanvas(pdf, n, dpi / 72);
          results.push({ blob: await canvasToBlob(canvas, "image/jpeg", quality / 100), filename: `${baseName(files[0].name)}-page-${n}.jpg` });
          canvas.width = canvas.height = 0;
        }
        return results;
      }}
    />
  );
}

// ── Layout helpers for the text converters ─────────────────────────────
function bodySize(all: TextLine[]) {
  const weight = new Map<number, number>();
  for (const l of all) weight.set(Math.round(l.size), (weight.get(Math.round(l.size)) ?? 0) + l.text.length);
  let best = 11;
  let bestW = 0;
  for (const [s, w] of weight) if (w > bestW) [best, bestW] = [s, w];
  return best;
}

const BULLET = /^([•●▪◦‣\-–—*]|\d+[.)])\s+/;
const hasArabic = (s: string) => /[؀-ۿ]/.test(s);

interface Para {
  text: string;
  size: number;
  bold: boolean;
  italic: boolean;
  heading: 0 | 1 | 2 | 3;
  center: boolean;
  bullet: boolean;
  /** Set when the line is laid out in columns (a table row): the text of each column. */
  cells?: string[];
}

/** Splits a line into column cells where there is a wide gap between pieces of text. */
function lineCells(line: TextLine): string[] {
  const cells: string[] = [];
  let prevEnd = 0;
  for (const r of line.runs) {
    if (cells.length && r.x - prevEnd <= r.size * 1.4) cells[cells.length - 1] += (r.x - prevEnd > r.size * 0.15 ? " " : "") + r.str;
    else cells.push(r.str);
    prevEnd = r.x + r.width;
  }
  return cells.map((c) => c.trim()).filter(Boolean);
}

/** Joins lines into paragraphs and spots headings, bullets and centred lines. */
function buildParagraphs(lines: TextLine[], body: number, pageWidth: number): Para[] {
  const out: Para[] = [];
  let prev: TextLine | null = null;
  let prevPara: Para | null = null;
  for (const line of lines) {
    const ratio = line.size / body;
    const heading: Para["heading"] = ratio >= 1.6 ? 1 : ratio >= 1.3 ? 2 : ratio >= 1.12 && line.bold ? 3 : 0;
    const first = line.runs[0];
    const last = line.runs[line.runs.length - 1];
    const mid = (first.x + last.x + last.width) / 2;
    const center = Math.abs(mid - pageWidth / 2) < pageWidth * 0.04 && last.x + last.width - first.x < pageWidth * 0.75;
    const bullet = BULLET.test(line.text);
    const cells = lineCells(line);
    const tabular = cells.length >= 2;
    const gap = prev ? line.y - prev.y : Infinity;
    const joinable = prevPara && !tabular && !prevPara.cells && !heading && !prevPara.heading && !bullet && !center && !prevPara.center && gap < line.size * 1.75 && Math.abs(line.size - prev!.size) < 1.2 && !/[.:;!?]$/.test(prevPara.text);
    if (joinable && prevPara) {
      prevPara.text += " " + line.text;
    } else {
      prevPara = { text: line.text, size: line.size, bold: line.bold, italic: line.italic, heading, center, bullet, cells: tabular ? cells : undefined };
      out.push(prevPara);
    }
    prev = line;
  }
  return out;
}

// ── PDF → Word ──────────────────────────────────────────────────────────
export function PdfToWordTool() {
  return (
    <FileTool
      toolId="pdf-to-word"
      kind="pdf"
      action="Convert to Word"
      run={async ({ files }, progress) => {
        const docx = await import("docx");
        const pdf = await openPdf(await readBytes(files[0]), files[0].name);
        const pagesLines: TextLine[][] = [];
        const widths: number[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          progress(`Reading page ${i} of ${pdf.numPages}…`);
          pagesLines.push(await pageTextLines(pdf, i));
          widths.push((await pdf.getPage(i)).getViewport({ scale: 1 }).width);
        }
        const all = pagesLines.flat();
        if (all.length === 0) throw new Error("No selectable text was found. This looks like a scanned PDF, which needs OCR.");
        const body = bodySize(all);
        const children: InstanceType<typeof docx.Paragraph>[] = [];
        const tables: number[] = [];
        pagesLines.forEach((lines, p) => {
          if (p > 0) children.push(new docx.Paragraph({ children: [new docx.PageBreak()] }));
          const paras = buildParagraphs(lines, body, widths[p]);
          for (let k = 0; k < paras.length; k++) {
            const para = paras[k];
            if (para.cells) {
              const rows: string[][] = [];
              while (k < paras.length && paras[k].cells) rows.push(paras[k++].cells!);
              k--;
              const cols = Math.max(...rows.map((r) => r.length));
              tables.push(children.length);
              children.push(
                new docx.Table({
                  width: { size: 100, type: docx.WidthType.PERCENTAGE },
                  rows: rows.map(
                    (r) =>
                      new docx.TableRow({
                        children: Array.from({ length: cols }, (_, i) => new docx.TableCell({ children: [new docx.Paragraph({ children: [new docx.TextRun({ text: r[i] ?? "", size: Math.round(body * 2) })] })] })),
                      }),
                  ),
                }) as unknown as InstanceType<typeof docx.Paragraph>,
              );
              continue;
            }
            const rtl = hasArabic(para.text);
            const heading = para.heading === 1 ? docx.HeadingLevel.HEADING_1 : para.heading === 2 ? docx.HeadingLevel.HEADING_2 : para.heading === 3 ? docx.HeadingLevel.HEADING_3 : undefined;
            children.push(
              new docx.Paragraph({
                heading,
                alignment: para.center ? docx.AlignmentType.CENTER : undefined,
                bidirectional: rtl || undefined,
                spacing: { after: 120 },
                children: [
                  new docx.TextRun({
                    text: para.text,
                    bold: para.bold || para.heading > 0,
                    italics: para.italic,
                    size: Math.max(16, Math.round(para.size * 2)),
                    rightToLeft: rtl || undefined,
                  }),
                ],
              }),
            );
          }
        });
        void tables;
        const doc = new docx.Document({ sections: [{ children: children as unknown as InstanceType<typeof docx.Paragraph>[] }] });
        const blob = await docx.Packer.toBlob(doc);
        return [{ blob, filename: `${baseName(files[0].name)}.docx`, note: "Text, headings and paragraphs are converted. Images and complex layouts are not." }];
      }}
    />
  );
}

// ── PDF → PowerPoint ────────────────────────────────────────────────────
export function PdfToPowerpointTool() {
  return (
    <FileTool
      toolId="pdf-to-powerpoint"
      kind="pdf"
      action="Convert to PowerPoint"
      run={async ({ files }, progress) => {
        const { default: PptxGenJS } = await import("pptxgenjs");
        const pdf = await openPdf(await readBytes(files[0]), files[0].name);
        const first = (await pdf.getPage(1)).getViewport({ scale: 1 });
        const W = first.width / 72;
        const H = first.height / 72;
        const pptx = new PptxGenJS();
        pptx.defineLayout({ name: "PDF", width: W, height: H });
        pptx.layout = "PDF";
        for (let i = 1; i <= pdf.numPages; i++) {
          progress(`Slide ${i} of ${pdf.numPages}…`);
          const canvas = await renderPageToCanvas(pdf, i, 2);
          const slide = pptx.addSlide();
          slide.addImage({ data: canvas.toDataURL("image/jpeg", 0.88), x: 0, y: 0, w: W, h: H });
          const text = (await pageTextLines(pdf, i)).map((l) => l.text).join("\n");
          if (text) slide.addNotes(text);
          canvas.width = canvas.height = 0;
        }
        const blob = (await pptx.write({ outputType: "blob" })) as Blob;
        return [{ blob, filename: `${baseName(files[0].name)}.pptx`, note: "Each page is a slide picture; the page text is in the speaker notes." }];
      }}
    />
  );
}

// ── PDF → Excel ─────────────────────────────────────────────────────────
export function tableRows(lines: TextLine[]): Array<Array<string | number>> {
  interface Cell {
    x: number;
    text: string;
  }
  const rows: Cell[][] = lines.map((line) => {
    const cells: Cell[] = [];
    let cur: Cell | null = null;
    let prevEnd = 0;
    for (const r of line.runs) {
      if (cur && r.x - prevEnd <= r.size * 1.1) cur.text += (r.x - prevEnd > r.size * 0.15 ? " " : "") + r.str;
      else {
        cur = { x: r.x, text: r.str };
        cells.push(cur);
      }
      prevEnd = r.x + r.width;
    }
    return cells.map((c) => ({ ...c, text: c.text.trim() }));
  });
  const xs = rows.flat().map((c) => c.x).sort((a, b) => a - b);
  const anchors: number[] = [];
  for (const x of xs) if (anchors.length === 0 || x - anchors[anchors.length - 1] > 10) anchors.push(x);
  return rows.map((cells) => {
    const row: Array<string | number> = Array(anchors.length).fill("");
    for (const c of cells) {
      let idx = 0;
      for (let i = 0; i < anchors.length; i++) if (anchors[i] <= c.x + 6) idx = i;
      const num = /^-?\(?[\d,]+(\.\d+)?\)?$/.test(c.text) ? Number(c.text.replace(/[,()]/g, "")) * (c.text.startsWith("(") ? -1 : 1) : NaN;
      row[idx] = row[idx] === "" ? (Number.isNaN(num) ? c.text : num) : `${row[idx]} ${c.text}`;
    }
    return row;
  });
}

export function PdfToExcelTool() {
  const [perPage, setPerPage] = useState(true);
  return (
    <FileTool
      toolId="pdf-to-excel"
      kind="pdf"
      action="Convert to Excel"
      options={() => (
        <label className="pt-check">
          <input type="checkbox" checked={perPage} onChange={(e) => setPerPage(e.target.checked)} /> Put each page on its own sheet
        </label>
      )}
      run={async ({ files }, progress) => {
        const XLSX = await import("xlsx");
        const pdf = await openPdf(await readBytes(files[0]), files[0].name);
        const wb = XLSX.utils.book_new();
        const combined: Array<Array<string | number>> = [];
        let any = false;
        for (let i = 1; i <= pdf.numPages; i++) {
          progress(`Reading page ${i} of ${pdf.numPages}…`);
          const rows = tableRows(await pageTextLines(pdf, i));
          if (rows.length === 0) continue;
          any = true;
          if (perPage) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), `Page ${i}`);
          else combined.push(...rows);
        }
        if (!any) throw new Error("No selectable text was found. This looks like a scanned PDF, which needs OCR.");
        if (!perPage) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(combined), "Sheet1");
        const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
        return [
          {
            blob: new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
            filename: `${baseName(files[0].name)}.xlsx`,
            note: "Columns are detected from where the text sits on the page. Check complex tables.",
          },
        ];
      }}
    />
  );
}

// ── PDF → Markdown ──────────────────────────────────────────────────────
export function PdfToMarkdownTool() {
  return (
    <FileTool
      toolId="pdf-to-markdown"
      kind="pdf"
      action="Convert to Markdown"
      run={async ({ files }, progress) => {
        const pdf = await openPdf(await readBytes(files[0]), files[0].name);
        const pages: TextLine[][] = [];
        const widths: number[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          progress(`Reading page ${i} of ${pdf.numPages}…`);
          pages.push(await pageTextLines(pdf, i));
          widths.push((await pdf.getPage(i)).getViewport({ scale: 1 }).width);
        }
        const all = pages.flat();
        if (all.length === 0) throw new Error("No selectable text was found. This looks like a scanned PDF, which needs OCR.");
        const body = bodySize(all);
        const parts: string[] = [];
        pages.forEach((lines, p) => {
          if (p > 0) parts.push("---");
          const paras = buildParagraphs(lines, body, widths[p]);
          for (let k = 0; k < paras.length; k++) {
            const para = paras[k];
            if (para.cells) {
              const rows: string[][] = [];
              while (k < paras.length && paras[k].cells) rows.push(paras[k++].cells!);
              k--;
              const cols = Math.max(...rows.map((r) => r.length));
              const row = (r: string[]) => "| " + Array.from({ length: cols }, (_, i) => (r[i] ?? "").replace(/\|/g, "\\|")).join(" | ") + " |";
              parts.push([row(rows[0]), "|" + " --- |".repeat(cols), ...rows.slice(1).map(row)].join("\n"));
              continue;
            }
            let t = para.text;
            if (para.heading) t = `${"#".repeat(para.heading)} ${t}`;
            else if (para.bullet) t = t.replace(BULLET, "- ");
            else if (para.bold && t.length < 120) t = `**${t}**`;
            else if (para.italic) t = `*${t}*`;
            parts.push(t);
          }
        });
        return [{ blob: new Blob([parts.join("\n\n") + "\n"], { type: "text/markdown" }), filename: `${baseName(files[0].name)}.md` }];
      }}
    />
  );
}

// ── Compare ─────────────────────────────────────────────────────────────
type Op = { t: "eq" | "del" | "add"; text: string };

function diffLines(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const dp = new Int32Array((n + 1) * (m + 1));
  const W = m + 1;
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i * W + j] = a[i] === b[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ t: "eq", text: a[i] });
      i++;
      j++;
    } else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) ops.push({ t: "del", text: a[i++] });
    else ops.push({ t: "add", text: b[j++] });
  }
  while (i < n) ops.push({ t: "del", text: a[i++] });
  while (j < m) ops.push({ t: "add", text: b[j++] });
  return ops;
}

async function docLines(file: File): Promise<string[]> {
  const pdf = await openPdf(await readBytes(file), file.name);
  const out: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) for (const l of await pageTextLines(pdf, i)) out.push(l.text.replace(/\s+/g, " ").trim());
  return out;
}

export function CompareTool() {
  const [a, setA] = useState<File | null>(null);
  const [b, setB] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ops, setOps] = useState<Op[] | null>(null);
  const pick = (set: (f: File | null) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    set(e.target.files?.[0] ?? null);
    setOps(null);
  };
  async function go() {
    if (!a || !b) return;
    setBusy(true);
    setError(null);
    try {
      const [la, lb] = await Promise.all([docLines(a), docLines(b)]);
      if (la.length > 4000 || lb.length > 4000) throw new Error("These documents are too long to compare here (over 4,000 lines).");
      if (la.length === 0 && lb.length === 0) throw new Error("No selectable text was found in either file.");
      setOps(diffLines(la, lb));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  const dels = ops?.filter((o) => o.t === "del").length ?? 0;
  const adds = ops?.filter((o) => o.t === "add").length ?? 0;
  return (
    <div className="pt-tool">
      <div className="pt-tool-head">
        <h1>Compare PDF</h1>
        <p>Show a side-by-side comparison and highlight the changes between two PDFs.</p>
      </div>
      <div className="pt-compare-pick">
        <label className="pt-drop has-files">
          <strong>Original</strong>
          <input type="file" accept="application/pdf,.pdf" onChange={pick(setA)} />
          {a && <span className="pt-file-meta">{formatBytes(a.size)}</span>}
        </label>
        <label className="pt-drop has-files">
          <strong>Changed version</strong>
          <input type="file" accept="application/pdf,.pdf" onChange={pick(setB)} />
          {b && <span className="pt-file-meta">{formatBytes(b.size)}</span>}
        </label>
      </div>
      {error && <div className="pt-error">{error}</div>}
      <div className="pt-run">
        <button type="button" className="pt-big" style={{ background: "#4a6fa5" }} disabled={!a || !b || busy} onClick={go}>
          {busy ? "Comparing…" : "Compare PDFs"}
        </button>
      </div>
      {ops && (
        <div className="pt-diff">
          <p className="pt-diff-stats">
            {dels === 0 && adds === 0 ? "No differences in text." : `${dels} line${dels === 1 ? "" : "s"} removed, ${adds} line${adds === 1 ? "" : "s"} added.`}
          </p>
          <table>
            <thead>
              <tr>
                <th>Original</th>
                <th>Changed version</th>
              </tr>
            </thead>
            <tbody>
              {ops.map((o, i) => (
                <tr key={i}>
                  <td className={o.t === "del" ? "del" : ""}>{o.t !== "add" ? o.text : ""}</td>
                  <td className={o.t === "add" ? "add" : ""}>{o.t !== "del" ? o.text : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="pt-privacy">Your files are processed inside your browser and are never uploaded to our servers.</p>
    </div>
  );
}
