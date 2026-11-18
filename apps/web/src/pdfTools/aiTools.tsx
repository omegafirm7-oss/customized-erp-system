import { ReactNode, useEffect, useRef, useState } from "react";
import { baseName, openPdf, pageTextLines, parseRange, readBytes, saveBlob } from "./engine";
import { toolById } from "./catalog";
import { Field } from "./organizeTools";

const AI_NOTE =
  "To do this, the text of your PDF is sent over a secure connection to our server and to Anthropic's Claude AI, which writes the result. We don't store your document or the result. Don't use it for documents you aren't allowed to share with an AI service.";

// ── Talking to the server ──────────────────────────────────────────────
async function postAi(path: string, fields: Record<string, string>, signal?: AbortSignal): Promise<any> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  let res: Response;
  try {
    res = await fetch(`/api/public/ai/${path}`, { method: "POST", body: form, signal });
  } catch (err: any) {
    if (err?.name === "AbortError") throw err;
    throw new Error("Could not reach the AI service. Check your connection and try again.");
  }
  if (!res.ok) {
    if (res.status === 413) throw new Error("That text is too large to send.");
    let message = "The AI service failed. Please try again.";
    try {
      const j = await res.json();
      if (j?.message) message = Array.isArray(j.message) ? j.message.join(" ") : String(j.message);
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }
  return res.json();
}

function useAiAvailable() {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/public/ai/status")
      .then((r) => r.json())
      .then((j) => setAvailable(!!j.available))
      .catch(() => setAvailable(null));
  }, []);
  return available;
}

// ── Reading the PDF ────────────────────────────────────────────────────
interface Extracted {
  pages: string[];
  chars: number;
}

async function extractText(file: File, onProgress?: (done: number, total: number) => void): Promise<Extracted> {
  const pdf = await openPdf(await readBytes(file), file.name);
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    onProgress?.(i, pdf.numPages);
    pages.push((await pageTextLines(pdf, i)).map((l) => l.text).join("\n"));
  }
  return { pages, chars: pages.reduce((n, p) => n + p.length, 0) };
}

// ── Languages ──────────────────────────────────────────────────────────
interface Lang {
  name: string;
  rtl: boolean;
  /** Whether the server has fonts to print this language into a PDF. */
  pdf: boolean;
}
const LANGS: Lang[] = [
  { name: "English", rtl: false, pdf: true },
  { name: "Arabic", rtl: true, pdf: true },
  { name: "French", rtl: false, pdf: true },
  { name: "Spanish", rtl: false, pdf: true },
  { name: "German", rtl: false, pdf: true },
  { name: "Italian", rtl: false, pdf: true },
  { name: "Portuguese", rtl: false, pdf: true },
  { name: "Turkish", rtl: false, pdf: true },
  { name: "Russian", rtl: false, pdf: true },
  { name: "Urdu", rtl: true, pdf: true },
  { name: "Hindi", rtl: false, pdf: false },
  { name: "Chinese (Simplified)", rtl: false, pdf: false },
];

const hasArabicScript = (s: string) => /[؀-ۿ]/.test(s);

// ── Output helpers ─────────────────────────────────────────────────────
function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Minimal Markdown for the summary: headings, bullets, **bold**. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
}
function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={blocks.length}>
          {list.map((li, i) => (
            <li key={i}>{inline(li)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (/^\s*[-*•]\s+/.test(line)) list.push(line.replace(/^\s*[-*•]\s+/, ""));
    else {
      flush();
      if (/^#{1,4}\s+/.test(line)) blocks.push(<h3 key={blocks.length}>{inline(line.replace(/^#{1,4}\s+/, ""))}</h3>);
      else if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
    }
  }
  flush();
  return <div className="pt-ai-text" dir={hasArabicScript(text) ? "rtl" : "auto"}>{blocks}</div>;
}

async function makeDocx(title: string, blocks: Array<{ kind: "h" | "p" | "li"; text: string }>, rtl: boolean): Promise<Blob> {
  const docx = await import("docx");
  const runs = (t: string) =>
    t.split(/(\*\*[^*]+\*\*)/g).map((part) =>
      part.startsWith("**") && part.endsWith("**")
        ? new docx.TextRun({ text: part.slice(2, -2), bold: true, rightToLeft: rtl || undefined })
        : new docx.TextRun({ text: part, rightToLeft: rtl || undefined }),
    );
  const children = [
    new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_1, bidirectional: rtl || undefined, children: [new docx.TextRun({ text: title, rightToLeft: rtl || undefined })] }),
    ...blocks.map((b) =>
      b.kind === "h"
        ? new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_2, bidirectional: rtl || undefined, children: runs(b.text) })
        : new docx.Paragraph({ bullet: b.kind === "li" ? { level: 0 } : undefined, bidirectional: rtl || undefined, spacing: { after: 120 }, children: runs(b.text) }),
    ),
  ];
  return docx.Packer.toBlob(new docx.Document({ sections: [{ children }] }));
}

function markdownBlocks(text: string) {
  return text
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim())
    .map((l) => {
      if (/^#{1,4}\s+/.test(l)) return { kind: "h" as const, text: l.replace(/^#{1,4}\s+/, "") };
      if (/^\s*[-*•]\s+/.test(l)) return { kind: "li" as const, text: l.replace(/^\s*[-*•]\s+/, "") };
      return { kind: "p" as const, text: l };
    });
}

// ── Shared shell: pick a PDF, read its text ────────────────────────────
function useTextFile() {
  const [file, setFile] = useState<File | null>(null);
  const [data, setData] = useState<Extracted | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open(f: File) {
    setError(null);
    setData(null);
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") {
      setError("Please choose a PDF file.");
      return;
    }
    setFile(f);
    setReading(true);
    try {
      const d = await extractText(f);
      if (d.chars < 50) {
        setFile(null);
        setError("This PDF has no selectable text. It looks like a scan, so run it through OCR PDF first, then try again.");
      } else setData(d);
    } catch (err: any) {
      setFile(null);
      setError(err.message);
    } finally {
      setReading(false);
    }
  }
  const reset = () => {
    setFile(null);
    setData(null);
    setError(null);
  };
  return { file, data, reading, error, open, reset };
}

function Picker({ onFile, label, error, reading }: { onFile: (f: File) => void; label: string; error: string | null; reading: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <>
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
          if (f) onFile(f);
        }}
      >
        <button type="button" className="pt-big" style={{ background: "#6f4cff" }} disabled={reading} onClick={() => inputRef.current?.click()}>
          {reading ? "Reading the PDF…" : label}
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
          if (f) onFile(f);
        }}
      />
    </>
  );
}

function Head({ id }: { id: string }) {
  const tool = toolById(id)!;
  useEffect(() => {
    document.title = `${tool.title} | Free PDF tools`;
  }, [tool.title]);
  return (
    <div className="pt-tool-head">
      <h1>{tool.title}</h1>
      <p>{tool.desc}</p>
    </div>
  );
}

function Unavailable({ available }: { available: boolean | null }) {
  if (available !== false) return null;
  return <div className="pt-error">The AI tools are not switched on yet on this server. They will start working as soon as the site owner connects the AI service.</div>;
}

// ── AI Summarizer ──────────────────────────────────────────────────────
export function SummarizerTool() {
  const available = useAiAvailable();
  const { file, data, reading, error: readError, open, reset } = useTextFile();
  const [length, setLength] = useState<"short" | "medium" | "detailed">("medium");
  const [language, setLanguage] = useState("same");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ text: string; truncated: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  async function go() {
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      const text = data.pages.map((p, i) => `[Page ${i + 1}]\n${p}`).join("\n\n");
      const res = await postAi("summarize", { text, length, language });
      setSummary({ text: res.summary, truncated: !!res.truncated });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pt-tool">
      <Head id="ai-summarizer" />
      <Unavailable available={available} />
      {!file || !data ? (
        <Picker onFile={open} label="Select PDF file" error={readError} reading={reading} />
      ) : summary ? (
        <div className="pt-result" style={{ justifyItems: "stretch", textAlign: "left" }}>
          <h2>Summary of {file.name}</h2>
          {summary.truncated && <p className="pt-hint">The document is very long, so only the first part was summarised.</p>}
          <Markdown text={summary.text} />
          <div className="form-row" style={{ gap: 8, display: "flex", flexWrap: "wrap" }}>
            <button
              type="button"
              className="pt-big sm"
              style={{ background: "#6f4cff" }}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(summary.text.replace(/\*\*/g, ""));
                  setCopied(true);
                } catch {
                  /* ignore */
                }
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              className="pt-ghost"
              onClick={async () => saveBlob(await makeDocx(`Summary of ${baseName(file.name)}`, markdownBlocks(summary.text), hasArabicScript(summary.text)), `${baseName(file.name)}-summary.docx`)}
            >
              Download Word
            </button>
            <button type="button" className="pt-ghost" onClick={() => saveBlob(new Blob([summary.text.replace(/\*\*/g, "")], { type: "text/plain;charset=utf-8" }), `${baseName(file.name)}-summary.txt`)}>
              Download text
            </button>
            <button
              type="button"
              className="pt-ghost"
              onClick={() => {
                setSummary(null);
                reset();
              }}
            >
              Summarize another
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="pt-options">
            <div className="pt-files" style={{ listStyle: "none" }}>
              <div className="pt-file-name">{file.name}</div>
              <div className="pt-file-meta">
                {data.pages.length} page{data.pages.length === 1 ? "" : "s"} · about {Math.round(data.chars / 6).toLocaleString()} words
              </div>
            </div>
            <div className="pt-grid">
              <Field label="How long should the summary be?">
                <select value={length} onChange={(e) => setLength(e.target.value as typeof length)}>
                  <option value="short">Short (key points)</option>
                  <option value="medium">Standard</option>
                  <option value="detailed">Detailed</option>
                </select>
              </Field>
              <Field label="Language of the summary">
                <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                  <option value="same">Same as the document</option>
                  {LANGS.map((l) => (
                    <option key={l.name} value={l.name}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
          {error && <div className="pt-error">{error}</div>}
          <div className="pt-run">
            <button type="button" className="pt-big" style={{ background: "#6f4cff" }} disabled={busy || available === false} onClick={go}>
              {busy ? "Summarising… this takes a few seconds" : "Summarize"}
            </button>
            <button type="button" className="pt-ghost" style={{ marginLeft: 8 }} onClick={reset}>
              Choose another file
            </button>
          </div>
        </>
      )}
      <p className="pt-privacy">{AI_NOTE}</p>
    </div>
  );
}

// ── Translate PDF ──────────────────────────────────────────────────────
const CHUNK_CHARS = 7000;
const MAX_TRANSLATE_TOTAL = 60000;

/** Splits one page's text into pieces that fit a request, breaking at line ends. */
function chunk(text: string): string[] {
  if (text.length <= CHUNK_CHARS) return [text];
  const parts: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur && cur.length + line.length + 1 > CHUNK_CHARS) {
      parts.push(cur);
      cur = "";
    }
    cur += (cur ? "\n" : "") + line;
  }
  if (cur) parts.push(cur);
  return parts;
}

export function TranslateTool() {
  const available = useAiAvailable();
  const { file, data, reading, error: readError, open, reset } = useTextFile();
  const [target, setTarget] = useState("English");
  const [range, setRange] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ pages: Array<{ n: number; text: string }>; lang: Lang } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const lang = LANGS.find((l) => l.name === target)!;

  async function go() {
    if (!data || !file) return;
    setError(null);
    let chosen: number[];
    try {
      chosen = range.trim() ? parseRange(range, data.pages.length) : data.pages.map((_, i) => i + 1);
    } catch (err: any) {
      setError(err.message);
      return;
    }
    const total = chosen.reduce((n, p) => n + data.pages[p - 1].length, 0);
    if (total > MAX_TRANSLATE_TOTAL) {
      setError(`That is about ${Math.round(total / 1000)},000 characters. Translate up to ${MAX_TRANSLATE_TOTAL.toLocaleString()} at a time by entering a page range above (for example 1-10).`);
      return;
    }
    const jobs = chosen.flatMap((p) => chunk(data.pages[p - 1]).map((text) => ({ page: p, text })));
    const ctl = new AbortController();
    abortRef.current = ctl;
    setBusy(true);
    const byPage = new Map<number, string[]>();
    try {
      for (let i = 0; i < jobs.length; i++) {
        setProgress(`Translating part ${i + 1} of ${jobs.length}…`);
        if (!jobs[i].text.trim()) continue;
        const res = await postAi("translate", { text: jobs[i].text, target }, ctl.signal);
        byPage.set(jobs[i].page, [...(byPage.get(jobs[i].page) ?? []), res.translation]);
      }
      setResult({ pages: chosen.map((n) => ({ n, text: (byPage.get(n) ?? []).join("\n") })), lang });
    } catch (err: any) {
      if (err?.name !== "AbortError") setError(err.message);
    } finally {
      setBusy(false);
      setProgress("");
      abortRef.current = null;
    }
  }

  async function downloadPdf() {
    if (!result || !file) return;
    setError(null);
    setBusy(true);
    setProgress("Preparing the PDF…");
    try {
      const body = result.pages
        .map((p) => `<section><h2>Page ${p.n}</h2>${p.text.split("\n").filter((l) => l.trim()).map((l) => `<p>${escapeHtml(l)}</p>`).join("")}</section>`)
        .join("");
      const html = `<!doctype html><html lang="en" dir="${result.lang.rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><style>body{font-family:"DejaVu Sans",Arial,sans-serif;font-size:11.5pt;line-height:1.6;color:#111}h2{font-size:10pt;color:#667;border-bottom:1px solid #ccd;margin:18pt 0 8pt;padding-bottom:3pt}p{margin:0 0 7pt}</style></head><body>${body}</body></html>`;
      const form = new FormData();
      form.append("html", html);
      form.append("pageSize", "A4");
      form.append("margin", "20");
      form.append("background", "false");
      const res = await fetch("/api/public/convert/html", { method: "POST", body: form });
      if (!res.ok) throw new Error("Could not create the PDF. Download the Word file instead.");
      saveBlob(await res.blob(), `${baseName(file.name)}-${result.lang.name.split(" ")[0].toLowerCase()}.pdf`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  return (
    <div className="pt-tool">
      <Head id="translate" />
      <Unavailable available={available} />
      {!file || !data ? (
        <Picker onFile={open} label="Select PDF file" error={readError} reading={reading} />
      ) : result ? (
        <div className="pt-result" style={{ justifyItems: "stretch", textAlign: "left" }}>
          <h2>
            Translated into {result.lang.name}
          </h2>
          <div className="pt-ai-text" dir={result.lang.rtl ? "rtl" : "ltr"} style={{ maxHeight: 360, overflow: "auto" }}>
            {result.pages.map((p) => (
              <div key={p.n}>
                <h3>Page {p.n}</h3>
                {p.text.split("\n").filter((l) => l.trim()).map((l, i) => (
                  <p key={i}>{l}</p>
                ))}
              </div>
            ))}
          </div>
          {error && <div className="pt-error">{error}</div>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="button" className="pt-big sm" style={{ background: "#6f4cff" }} disabled={busy || !result.lang.pdf} onClick={downloadPdf} title={result.lang.pdf ? "" : "PDF output isn't available for this language yet. Use Word."}>
              {busy ? progress || "Working…" : "Download PDF"}
            </button>
            <button
              type="button"
              className="pt-ghost"
              onClick={async () =>
                saveBlob(
                  await makeDocx(
                    `${baseName(file.name)} (${result.lang.name})`,
                    result.pages.flatMap((p) => [{ kind: "h" as const, text: `Page ${p.n}` }, ...p.text.split("\n").filter((l) => l.trim()).map((l) => ({ kind: "p" as const, text: l }))]),
                    result.lang.rtl,
                  ),
                  `${baseName(file.name)}-${result.lang.name.split(" ")[0].toLowerCase()}.docx`,
                )
              }
            >
              Download Word
            </button>
            <button
              type="button"
              className="pt-ghost"
              onClick={() => saveBlob(new Blob([result.pages.map((p) => `--- Page ${p.n} ---\n${p.text}`).join("\n\n")], { type: "text/plain;charset=utf-8" }), `${baseName(file.name)}-${result.lang.name.split(" ")[0].toLowerCase()}.txt`)}
            >
              Download text
            </button>
            <button
              type="button"
              className="pt-ghost"
              onClick={() => {
                setResult(null);
                reset();
              }}
            >
              Translate another
            </button>
          </div>
          {!result.lang.pdf && <p className="pt-hint">PDF output isn't available for {result.lang.name} yet. Use the Word file.</p>}
        </div>
      ) : (
        <>
          <div className="pt-options">
            <div className="pt-files" style={{ listStyle: "none" }}>
              <div className="pt-file-name">{file.name}</div>
              <div className="pt-file-meta">
                {data.pages.length} page{data.pages.length === 1 ? "" : "s"} · about {Math.round(data.chars / 6).toLocaleString()} words
              </div>
            </div>
            <div className="pt-grid">
              <Field label="Translate into">
                <select value={target} onChange={(e) => setTarget(e.target.value)}>
                  {LANGS.map((l) => (
                    <option key={l.name} value={l.name}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Pages (optional)" hint={`Leave empty for all ${data.pages.length}. Up to about ${MAX_TRANSLATE_TOTAL.toLocaleString()} characters at a time.`}>
                <input value={range} onChange={(e) => setRange(e.target.value)} placeholder="All pages" />
              </Field>
            </div>
            <small className="pt-hint">The text is translated; the page layout, tables and pictures of the original are not reproduced. You get a clean text document in the new language.</small>
          </div>
          {error && <div className="pt-error">{error}</div>}
          <div className="pt-run">
            <button type="button" className="pt-big" style={{ background: "#6f4cff" }} disabled={busy || available === false} onClick={go}>
              {busy ? progress || "Translating…" : "Translate"}
            </button>
            {busy && (
              <button type="button" className="pt-ghost" style={{ marginLeft: 8 }} onClick={() => abortRef.current?.abort()}>
                Cancel
              </button>
            )}
            {!busy && (
              <button type="button" className="pt-ghost" style={{ marginLeft: 8 }} onClick={reset}>
                Choose another file
              </button>
            )}
          </div>
        </>
      )}
      <p className="pt-privacy">{AI_NOTE}</p>
    </div>
  );
}
