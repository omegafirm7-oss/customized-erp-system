import { useState } from "react";
import { PDFDocument } from "pdf-lib";
import { Field } from "./organizeTools";
import fontkit from "@pdf-lib/fontkit";
import { baseName, canvasToBlob, openPdf, pdfBlob, readBytes, renderPageToCanvas } from "./engine";
import { FileTool } from "./ui";

// ── qpdf in the browser (Protect and Unlock) ───────────────────────────
interface QpdfResult {
  status: number;
  out: Uint8Array | null;
  log: string;
}

/** Runs qpdf (compiled to WebAssembly) on one PDF. A fresh instance per run keeps runs independent. */
async function qpdfRun(input: Uint8Array, args: (inPath: string, outPath: string) => string[]): Promise<QpdfResult> {
  const { default: createModule } = await import("@neslinesli93/qpdf-wasm");
  const wasmUrl = (await import("@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url")).default;
  const log: string[] = [];
  const qpdf: any = await (createModule as any)({
    locateFile: () => wasmUrl,
    noInitialRun: true,
    print: (s: string) => log.push(s),
    printErr: (s: string) => log.push(s),
  });
  qpdf.FS.writeFile("/in.pdf", input);
  let status = 0;
  try {
    status = qpdf.callMain(args("/in.pdf", "/out.pdf")) ?? 0;
  } catch (e: any) {
    status = typeof e?.status === "number" ? e.status : 1;
  }
  let out: Uint8Array | null = null;
  try {
    out = qpdf.FS.readFile("/out.pdf") as Uint8Array;
  } catch {
    /* no output */
  }
  return { status, out, log: log.join("\n") };
}

/** A cheap check for "this PDF has an encryption dictionary", used when qpdf's own message isn't available. */
const looksEncrypted = (bytes: Uint8Array) => {
  const latin1 = new TextDecoder("latin1");
  return (latin1.decode(bytes.subarray(Math.max(0, bytes.length - 4096))) + latin1.decode(bytes.subarray(0, 2048))).includes("/Encrypt");
};

const randomPassword = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(28));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
};

// ── Protect PDF ─────────────────────────────────────────────────────────
export function ProtectTool() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [allowPrint, setAllowPrint] = useState(true);
  const [allowCopy, setAllowCopy] = useState(false);
  const [allowEdit, setAllowEdit] = useState(false);
  return (
    <FileTool
      toolId="protect"
      kind="pdf"
      action="Protect PDF"
      noPageCount
      options={() => (
        <>
          <div className="pt-grid">
            <Field label="Password to open the PDF">
              <input type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label="Repeat the password">
              <input type={show ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            </Field>
          </div>
          <label className="pt-check">
            <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show the password
          </label>
          <div>
            <strong style={{ fontSize: 13 }}>What people who open it may do</strong>
            <label className="pt-check">
              <input type="checkbox" checked={allowPrint} onChange={(e) => setAllowPrint(e.target.checked)} /> Print
            </label>
            <label className="pt-check">
              <input type="checkbox" checked={allowCopy} onChange={(e) => setAllowCopy(e.target.checked)} /> Copy text and images
            </label>
            <label className="pt-check">
              <input type="checkbox" checked={allowEdit} onChange={(e) => setAllowEdit(e.target.checked)} /> Edit and add notes
            </label>
          </div>
          <small className="pt-hint">Strong AES-256 encryption. If you forget the password it cannot be recovered, so keep it somewhere safe.</small>
        </>
      )}
      validate={() => (password.length < 4 ? "Choose a password of at least 4 characters." : password !== confirm ? "The two passwords don't match." : null)}
      run={async ({ files }, progress) => {
        progress("Encrypting…");
        const input = await readBytes(files[0]);
        // The owner password is random, so the permission choices above can't be switched off by whoever opens the file.
        const owner = randomPassword();
        const { status, out, log } = await qpdfRun(input, (i, o) => [
          "--encrypt",
          password,
          owner,
          "256",
          `--print=${allowPrint ? "full" : "none"}`,
          `--modify=${allowEdit ? "all" : "none"}`,
          `--extract=${allowCopy ? "y" : "n"}`,
          `--annotate=${allowEdit ? "y" : "n"}`,
          "--",
          i,
          o,
        ]);
        if (!out || (status !== 0 && status !== 3)) {
          if (/password|encrypt/i.test(log) || looksEncrypted(input)) throw new Error("This PDF is already protected. Unlock it first, then protect it again.");
          throw new Error("This PDF could not be protected. It may be damaged.");
        }
        return [{ blob: pdfBlob(out), filename: `${baseName(files[0].name)}-protected.pdf`, note: "Opens only with your password. Keep the password safe." }];
      }}
    />
  );
}

// ── Unlock PDF ──────────────────────────────────────────────────────────
export function UnlockTool() {
  const [password, setPassword] = useState("");
  return (
    <FileTool
      toolId="unlock"
      kind="pdf"
      action="Unlock PDF"
      noPageCount
      options={() => (
        <Field label="Password (leave empty if the PDF opens without one)" hint="Only use this on PDFs you own or are allowed to unlock. The password is used inside your browser and is not sent anywhere.">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
        </Field>
      )}
      run={async ({ files }, progress) => {
        progress("Unlocking…");
        const input = await readBytes(files[0]);
        const { status, out, log } = await qpdfRun(input, (i, o) => ["--decrypt", ...(password ? [`--password=${password}`] : []), i, o]);
        if (!out || (status !== 0 && status !== 3)) {
          if (/invalid password/i.test(log) || looksEncrypted(input)) throw new Error(password ? "That password is not correct." : "This PDF needs a password to open. Enter it above.");
          throw new Error("This PDF could not be unlocked. It may be damaged.");
        }
        const wasLocked = !/not encrypted/i.test(log);
        return [{ blob: pdfBlob(out), filename: `${baseName(files[0].name)}-unlocked.pdf`, note: wasLocked ? "The password and restrictions were removed." : "This PDF wasn't protected, so it was saved unchanged." }];
      }}
    />
  );
}

// ── OCR PDF ─────────────────────────────────────────────────────────────
const LANGS: Record<string, { label: string; langs: string[] }> = {
  eng: { label: "English", langs: ["eng"] },
  ara: { label: "Arabic", langs: ["ara"] },
  both: { label: "English and Arabic", langs: ["eng", "ara"] },
};

export function OcrTool() {
  const [lang, setLang] = useState("eng");
  const [dpi, setDpi] = useState(200);
  const [skipText, setSkipText] = useState(true);
  return (
    <FileTool
      toolId="ocr"
      kind="pdf"
      action="Make PDF searchable"
      options={({ pages }) => (
        <>
          <div className="pt-grid">
            <Field label="Language in the document">
              <select value={lang} onChange={(e) => setLang(e.target.value)}>
                {Object.entries(LANGS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Scan quality used for reading">
              <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
                <option value={150}>150 dpi (fast)</option>
                <option value={200}>200 dpi (recommended)</option>
                <option value={300}>300 dpi (small print, slower)</option>
              </select>
            </Field>
          </div>
          <label className="pt-check">
            <input type="checkbox" checked={skipText} onChange={(e) => setSkipText(e.target.checked)} /> Leave pages that already contain text untouched
          </label>
          <small className="pt-hint">
            Reading happens on your computer and takes a few seconds per page{pages[0] ? ` (about ${Math.max(1, Math.round(pages[0] * 0.1))} to ${Math.max(1, Math.round(pages[0] * 0.3))} minutes for ${pages[0]} pages)` : ""}. Keep this tab open.
          </small>
        </>
      )}
      run={async ({ files }, progress) => {
        const bytes = await readBytes(files[0]);
        const pdf = await openPdf(bytes, files[0].name);
        const original = await PDFDocument.load(bytes).catch(() => null);
        const { createWorker } = await import("tesseract.js");
        const origin = window.location.origin;
        let current = 0;
        progress("Loading the reading engine…");
        const worker = await createWorker(LANGS[lang].langs, 1, {
          workerPath: `${origin}/ocr/worker.min.js`,
          corePath: `${origin}/ocr`,
          langPath: `${origin}/ocr/lang`,
          gzip: true,
          logger: (m: { status: string; progress: number }) => {
            if (m.status === "recognizing text") progress(`Page ${current} of ${pdf.numPages}: reading text ${Math.round(m.progress * 100)}%`);
          },
        });
        const out = await PDFDocument.create();
        // Invisible text layer: written in reading order with a font that has Arabic letters, so search and copy work for Arabic too.
        out.registerFontkit(fontkit);
        const fontBytes = new Uint8Array(await (await fetch("/ocr/fonts/DejaVuSans.ttf")).arrayBuffer());
        const textFont = await out.embedFont(fontBytes, { subset: true });
        let recognised = 0;
        let kept = 0;
        try {
          for (let i = 1; i <= pdf.numPages; i++) {
            current = i;
            const page = await pdf.getPage(i);
            const vp = page.getViewport({ scale: 1 });
            if (skipText && original) {
              const chars = (await page.getTextContent()).items.reduce((n: number, it: any) => n + String(it.str ?? "").trim().length, 0);
              if (chars >= 40) {
                const [copied] = await out.copyPages(original, [i - 1]);
                out.addPage(copied);
                kept++;
                continue;
              }
            }
            progress(`Page ${i} of ${pdf.numPages}: preparing…`);
            const canvas = await renderPageToCanvas(pdf, i, dpi / 72);
            const { data } = await worker.recognize(canvas, {}, { blocks: true });
            const image = await out.embedJpg(await readBytes(await canvasToBlob(canvas, "image/jpeg", 0.85)));
            const k = vp.width / canvas.width; // pixels -> PDF points
            const outPage = out.addPage([vp.width, vp.height]);
            outPage.drawImage(image, { x: 0, y: 0, width: vp.width, height: vp.height });
            const words = (data.blocks ?? []).flatMap((b: any) => b.paragraphs.flatMap((p: any) => p.lines.flatMap((l: any) => l.words)));
            for (const w of words) {
              const text = String(w.text ?? "").trim();
              if (!text) continue;
              const h = (w.bbox.y1 - w.bbox.y0) * k;
              const size = Math.max(4, h * 0.85);
              try {
                outPage.drawText(text, { x: w.bbox.x0 * k, y: vp.height - w.bbox.y1 * k + h * 0.2, size, font: textFont, opacity: 0 });
              } catch {
                /* a character the font can't draw: leave this word out of the text layer */
              }
            }
            canvas.width = canvas.height = 0;
            recognised++;
          }
        } finally {
          await worker.terminate();
        }
        if (recognised === 0) throw new Error("Every page already contains text, so there was nothing to read. Untick the option above to read them anyway.");
        return [
          {
            blob: pdfBlob(await out.save()),
            filename: `${baseName(files[0].name)}-searchable.pdf`,
            note: `${recognised} page${recognised === 1 ? "" : "s"} made searchable${kept ? `, ${kept} already had text` : ""}. You can now search and copy text.`,
          },
        ];
      }}
    />
  );
}

