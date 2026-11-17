import { BlendMode, LineCapStyle, PDFDocument, PDFFont, PDFImage, StandardFonts, degrees, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { drawAnn, fontRegistry, isWinAnsi, textToPng } from "./draw";
import { Ann, BASELINE, DocState, LINE_HEIGHT, PdfSource } from "./types";

const hexColor = (c: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c);
  const n = parseInt(m ? m[1] : "000000", 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

interface PageGeometry {
  width: number;
  height: number;
  /** Total clockwise rotation of the displayed page (0/90/180/270). */
  rotation: number;
  /** Display point (top-left origin) -> PDF user-space point. */
  toUser: (x: number, y: number) => [number, number];
}

const dataUrlBytes = (dataUrl: string) => {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/**
 * Builds the edited PDF. Normal mode keeps the original pages (text stays
 * selectable) and draws the edits on top. Flatten mode turns every page into
 * a picture with the edits baked in, which also removes any text hidden
 * under a whiteout, so use it for redactions.
 */
export async function exportPdf(
  sources: Map<number, PdfSource>,
  state: DocState,
  opts: { flatten: boolean },
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);
  const ownFonts = new Map<string, PDFFont | null>();
  const loaded = new Map<number, PDFDocument>();
  const fonts = new Map<string, PDFFont>();

  async function srcDoc(id: number) {
    let d = loaded.get(id);
    if (!d) {
      d = await PDFDocument.load(sources.get(id)!.bytes);
      loaded.set(id, d);
    }
    return d;
  }

  for (let n = 0; n < state.pages.length; n++) {
    const p = state.pages[n];
    const anns = state.anns[p.key] ?? [];
    let geo: PageGeometry;
    let pdfPage: ReturnType<PDFDocument["addPage"]>;
    let jsPage: Awaited<ReturnType<PdfSource["pdf"]["getPage"]> > | null = null;

    if (p.src === -1) {
      const { w, h } = p.blank!;
      geo = { width: w, height: h, rotation: 0, toUser: (x, y) => [x, h - y] };
      pdfPage = out.addPage([w, h]);
    } else {
      const src = sources.get(p.src)!;
      jsPage = await src.pdf.getPage(p.index + 1);
      const total = (jsPage.rotate + p.rotation) % 360;
      const vp = jsPage.getViewport({ scale: 1, rotation: total });
      geo = { width: vp.width, height: vp.height, rotation: total, toUser: (x, y) => vp.convertToPdfPoint(x, y) as [number, number] };
      if (!opts.flatten) {
        const [copied] = await out.copyPages(await srcDoc(p.src), [p.index]);
        copied.setRotation(degrees((copied.getRotation().angle + p.rotation) % 360));
        pdfPage = out.addPage(copied);
      } else {
        pdfPage = out.addPage([geo.width, geo.height]);
      }
    }

    if (opts.flatten) {
      const k = 2.5;
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(geo.width * k);
      canvas.height = Math.ceil(geo.height * k);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (jsPage) {
        await jsPage.render({ canvasContext: ctx, viewport: jsPage.getViewport({ scale: k, rotation: geo.rotation }) }).promise;
      }
      for (const a of anns) await drawAnn(ctx, a, k);
      const blob: Blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not flatten a page"))), "image/jpeg", 0.92));
      const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      pdfPage.drawImage(img, { x: 0, y: 0, width: geo.width, height: geo.height });
      onProgress?.(n + 1, state.pages.length);
      continue;
    }

    const placeImage = (img: PDFImage, x: number, y: number, w: number, h: number) => {
      const [ux, uy] = geo.toUser(x, y + h); // the image's own bottom-left corner
      pdfPage.drawImage(img, { x: ux, y: uy, width: w, height: h, rotate: degrees(geo.rotation) });
    };

    for (const a of anns as Ann[]) {
      if (a.kind === "cover" || a.kind === "highlight" || a.kind === "rect") {
        const [x1, y1] = geo.toUser(a.x, a.y);
        const [x2, y2] = geo.toUser(a.x + a.w, a.y + a.h);
        const box = { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
        if (a.kind === "cover") pdfPage.drawRectangle({ ...box, color: hexColor(a.color), borderWidth: 0 });
        else if (a.kind === "highlight") pdfPage.drawRectangle({ ...box, color: hexColor(a.color), opacity: 0.4, blendMode: BlendMode.Multiply, borderWidth: 0 });
        else pdfPage.drawRectangle({ ...box, borderColor: hexColor(a.color), borderWidth: a.width });
      } else if (a.kind === "pen") {
        const pts = a.points.map(([x, y]) => geo.toUser(x, y));
        for (let i = 1; i < pts.length; i++) {
          pdfPage.drawLine({
            start: { x: pts[i - 1][0], y: pts[i - 1][1] },
            end: { x: pts[i][0], y: pts[i][1] },
            thickness: a.width,
            color: hexColor(a.color),
            lineCap: LineCapStyle.Round,
          });
        }
      } else if (a.kind === "image") {
        const img = a.dataUrl.startsWith("data:image/jpeg") ? await out.embedJpg(dataUrlBytes(a.dataUrl)) : await out.embedPng(dataUrlBytes(a.dataUrl));
        placeImage(img, a.x, a.y, a.w, a.h);
      } else if (a.kind === "text") {
        const clean = a.text.replace(/\r/g, "").replace(/\t/g, "    ");
        if (!clean.trim()) continue;
        // The document's own font, when it is in the file and can draw every character typed.
        let own: PDFFont | null = null;
        if (a.fontKey && geo.rotation === 0 && !/[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(clean)) {
          if (!ownFonts.has(a.fontKey)) {
            const reg = fontRegistry.get(a.fontKey);
            try {
              ownFonts.set(a.fontKey, reg?.data ? await out.embedFont(reg.data, { subset: true }) : null);
            } catch {
              ownFonts.set(a.fontKey, null);
            }
          }
          const candidate = ownFonts.get(a.fontKey) ?? null;
          if (candidate) {
            const set = new Set(candidate.getCharacterSet());
            if ([...clean].every((ch) => ch === "\n" || set.has(ch.codePointAt(0)!))) own = candidate;
          }
        }
        if (own) {
          clean.split("\n").forEach((line, i) => {
            const [ux, uy] = geo.toUser(a.x, a.y + a.size * BASELINE + i * a.size * LINE_HEIGHT);
            if (line) pdfPage.drawText(line, { x: ux, y: uy, size: a.size, font: own!, color: hexColor(a.color) });
          });
        } else if (geo.rotation === 0 && isWinAnsi(clean)) {
          const std = a.serif
            ? a.bold
              ? a.italic ? StandardFonts.TimesRomanBoldItalic : StandardFonts.TimesRomanBold
              : a.italic ? StandardFonts.TimesRomanItalic : StandardFonts.TimesRoman
            : a.bold
              ? a.italic ? StandardFonts.HelveticaBoldOblique : StandardFonts.HelveticaBold
              : a.italic ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica;
          let font = fonts.get(std);
          if (!font) {
            font = await out.embedFont(std);
            fonts.set(std, font);
          }
          clean.split("\n").forEach((line, i) => {
            const [ux, uy] = geo.toUser(a.x, a.y + a.size * BASELINE + i * a.size * LINE_HEIGHT);
            if (line) pdfPage.drawText(line, { x: ux, y: uy, size: a.size, font, color: hexColor(a.color) });
          });
        } else {
          // Arabic and other scripts, or a rotated page: draw the text as a picture so it looks exactly as on screen.
          const png = await textToPng({ ...a, text: clean }, 4);
          placeImage(await out.embedPng(png.bytes), png.x, png.y, png.w, png.h);
        }
      }
    }
    onProgress?.(n + 1, state.pages.length);
  }

  return out.save();
}
