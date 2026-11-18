import * as pdfjs from "pdfjs-dist";
// Bundled as a normal .js worker so it works whatever MIME type the web server gives .mjs files.
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

if (!pdfjs.GlobalWorkerOptions.workerPort) pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();

export { pdfjs };
export type { PDFDocumentProxy, PDFPageProxy };

export const readBytes = async (f: File | Blob) => new Uint8Array(await f.arrayBuffer());

export class PasswordError extends Error {}

/** Opens a PDF for reading/rendering. Throws a friendly error for broken or password-protected files. */
export async function openPdf(bytes: Uint8Array, name = "The file"): Promise<PDFDocumentProxy> {
  try {
    return await pdfjs.getDocument({ data: bytes.slice() }).promise;
  } catch (err: any) {
    if (err?.name === "PasswordException") throw new PasswordError(`${name} is password-protected. Remove the password first.`);
    throw new Error(`${name} could not be opened as a PDF.`);
  }
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export const baseName = (name: string) => name.replace(/\.[^.]+$/, "");

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

export const pdfBlob = (bytes: Uint8Array) => new Blob([bytes as BlobPart], { type: "application/pdf" });

/**
 * Page ranges such as "1-3, 5, 8-" (1-based). Each comma part becomes one
 * group, so splitting can write one file per group. "n" or "last" means the last page.
 */
export function parseRangeGroups(input: string, max: number): number[][] {
  const groups: number[][] = [];
  for (const raw of input.split(",")) {
    const part = raw.trim().toLowerCase().replace(/\s+/g, "");
    if (!part) continue;
    const num = (s: string) => (s === "last" || s === "n" ? max : Number(s));
    const m = /^(\d+|last|n)?-(\d+|last|n)?$/.exec(part);
    let from: number;
    let to: number;
    if (m) {
      from = m[1] ? num(m[1]) : 1;
      to = m[2] ? num(m[2]) : max;
    } else if (/^(\d+|last|n)$/.test(part)) {
      from = to = num(part);
    } else {
      throw new Error(`"${raw.trim()}" is not a valid page range. Use something like 1-3, 5, 8-`);
    }
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < 1) throw new Error(`"${raw.trim()}" is not a valid page range.`);
    if (from > max || to > max) throw new Error(`The document has ${max} page${max === 1 ? "" : "s"}, but "${raw.trim()}" goes past that.`);
    const g: number[] = [];
    if (from <= to) for (let i = from; i <= to; i++) g.push(i);
    else for (let i = from; i >= to; i--) g.push(i);
    groups.push(g);
  }
  if (groups.length === 0) throw new Error("Enter the pages you want, for example 1-3, 5, 8-");
  return groups;
}

export const parseRange = (input: string, max: number) => parseRangeGroups(input, max).flat();

export async function renderPageToCanvas(pdf: PDFDocumentProxy, pageNumber: number, scale: number): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

export const canvasToBlob = (canvas: HTMLCanvasElement, type = "image/jpeg", quality = 0.9): Promise<Blob> =>
  new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not create the image"))), type, quality));

/** Display geometry of every page (after the page's own rotation), plus a map from display points to PDF user space. */
export interface PageGeo {
  width: number;
  height: number;
  rotation: number;
  toUser: (x: number, y: number) => [number, number];
}

export async function pageGeometry(pdf: PDFDocumentProxy): Promise<PageGeo[]> {
  const out: PageGeo[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    out.push({ width: vp.width, height: vp.height, rotation: vp.rotation, toUser: (x, y) => vp.convertToPdfPoint(x, y) as [number, number] });
  }
  return out;
}

export interface TextRun {
  str: string;
  x: number;
  /** Baseline, measured from the top of the page. */
  y: number;
  size: number;
  width: number;
  bold: boolean;
  italic: boolean;
}

export interface TextLine {
  y: number;
  size: number;
  runs: TextRun[];
  text: string;
  bold: boolean;
  italic: boolean;
}

/** Text of a page grouped into lines in reading order, with font size and style. */
export async function pageTextLines(pdf: PDFDocumentProxy, pageNumber: number): Promise<TextLine[]> {
  const page = await pdf.getPage(pageNumber);
  try {
    await page.getOperatorList(); // makes pdf.js load the page's fonts so their names are available
  } catch {
    /* style detection is optional */
  }
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const styleCache = new Map<string, { bold: boolean; italic: boolean }>();
  const styleOf = (fontName: string) => {
    let s = styleCache.get(fontName);
    if (!s) {
      let name = fontName;
      try {
        const f: any = page.commonObjs.has(fontName) ? page.commonObjs.get(fontName) : null;
        name = String(f?.name ?? fontName);
        s = { bold: !!f?.bold || /bold|black|heavy|semibold|demi/i.test(name), italic: !!f?.italic || /italic|oblique/i.test(name) };
      } catch {
        s = { bold: /bold/i.test(name), italic: /italic|oblique/i.test(name) };
      }
      styleCache.set(fontName, s);
    }
    return s;
  };

  const runs: TextRun[] = [];
  for (const it of content.items as any[]) {
    if (!it.str || !it.str.trim()) continue;
    const t = pdfjs.Util.transform(vp.transform, it.transform) as number[];
    const size = Math.hypot(t[0], t[1]) || 10;
    const st = styleOf(it.fontName);
    runs.push({ str: it.str, x: t[4], y: t[5], size, width: it.width * vp.scale, bold: st.bold, italic: st.italic });
  }
  runs.sort((a, b) => a.y - b.y || a.x - b.x);

  const lines: TextLine[] = [];
  for (const r of runs) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - r.y) < Math.max(2, Math.min(last.size, r.size) * 0.45)) last.runs.push(r);
    else lines.push({ y: r.y, size: r.size, runs: [r], text: "", bold: false, italic: false });
  }
  for (const line of lines) {
    line.runs.sort((a, b) => a.x - b.x);
    let text = "";
    let prev: TextRun | null = null;
    for (const r of line.runs) {
      if (prev) {
        const gap = r.x - (prev.x + prev.width);
        if (gap > r.size * 0.15 && !text.endsWith(" ") && !r.str.startsWith(" ")) text += " ";
      }
      text += r.str;
      prev = r;
    }
    line.text = text.trim();
    line.size = Math.max(...line.runs.map((r) => r.size));
    line.bold = line.runs.every((r) => r.bold);
    line.italic = line.runs.every((r) => r.italic);
  }
  return lines.filter((l) => l.text.length > 0);
}
