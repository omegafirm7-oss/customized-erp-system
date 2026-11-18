import { ChangeEvent, DragEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { baseName, formatBytes, openPdf, saveBlob } from "./engine";
import { IconKey, ToolMeta, toolById } from "./catalog";

const PATHS: Partial<Record<IconKey, string>> = {
  merge: "M5 4v4a4 4 0 0 0 4 4h6 M19 4v4a4 4 0 0 1-4 4 M12 12v8 M9 17l3 3 3-3",
  split: "M12 4v8 M12 12L6 20 M12 12l6 8 M9 7l3-3 3 3",
  remove: "M6 6l12 12 M18 6L6 18",
  extract: "M5 4h10v10H5z M13 13l7 7 M15 20h5v-5",
  organize: "M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z",
  scan: "M4 8V5a1 1 0 0 1 1-1h3 M16 4h3a1 1 0 0 1 1 1v3 M20 16v3a1 1 0 0 1-1 1h-3 M8 20H5a1 1 0 0 1-1-1v-3 M4 12h16",
  compress: "M5 5l5 5 M10 6v4H6 M19 19l-5-5 M14 18v-4h4",
  repair: "M14 6l4 4-8 8H6v-4z M13 7l4 4",
  ocr: "M4 7V5h4 M20 7V5h-4 M4 17v2h4 M20 17v2h-4 M8 10h8 M8 14h5",
  image: "M4 5h16v14H4z M4 16l5-5 4 4 3-3 4 4 M15 9.5h.01",
  rotate: "M20 11a8 8 0 1 0-2.3 5.7 M20 5v6h-6",
  numbers: "M8 4L6 20 M16 4l-2 16 M4 9h16 M3 15h16",
  watermark: "M12 3c3 4 6 7 6 10a6 6 0 0 1-12 0c0-3 3-6 6-10z",
  crop: "M7 3v14h14 M3 7h14v14",
  edit: "M4 20h4L19 9l-4-4L4 16z M14 6l4 4",
  forms: "M5 4h14v16H5z M8 9h8 M8 13h8 M8 17h4",
  unlock: "M6 11h12v9H6z M9 11V8a3 3 0 0 1 6 0",
  protect: "M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z M9 12l2 2 4-4",
  sign: "M4 21h16 M5 16l9-9 3 3-9 9H5z",
  redact: "M4 6h16v4H4z M4 14h10v4H4z",
  compare: "M4 5h7v14H4z M13 5h7v14h-7z",
  summary: "M5 6h14 M5 11h14 M5 16h8 M17 15v6 M14 18h6",
  translate: "M4 5h9 M8 3v2 M6 5c0 4 3 7 6 8 M11 5c-1 4-4 7-7 8 M13 21l4-10 4 10 M14.5 18h5",
};
const LETTERS: Partial<Record<IconKey, string>> = { word: "W", ppt: "P", excel: "X", html: "</>", pdfa: "A", markdown: "MD" };

export function ToolIcon({ tool, size = 48 }: { tool: ToolMeta; size?: number }) {
  const letter = LETTERS[tool.icon];
  return (
    <span className="pt-icon" style={{ width: size, height: size, background: tool.color, borderRadius: size * 0.22 }}>
      <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {letter ? (
          <text x="12" y="17" textAnchor="middle" fontSize={letter.length > 2 ? 9 : 14} fontWeight="700" fill="#fff" stroke="none" fontFamily="Arial, sans-serif">
            {letter}
          </text>
        ) : (
          PATHS[tool.icon]?.split(" M").map((d, i) => <path key={i} d={(i === 0 ? "" : "M") + d} />)
        )}
      </svg>
    </span>
  );
}

export interface ToolResult {
  blob: Blob;
  filename: string;
  note?: string;
}

interface Item {
  id: string;
  file: File;
  pages?: number;
  error?: string;
}

export interface ToolContext {
  files: File[];
  /** Page counts, same order as files (PDF tools). */
  pages: number[];
}

interface FileToolProps {
  toolId: string;
  kind: "pdf" | "image" | "excel" | "word" | "ppt";
  /** Replaces the privacy line (used by tools that convert on our server). */
  privacy?: string;
  multiple?: boolean;
  minFiles?: number;
  /** Label of the main button. */
  action: string;
  /** Extra checks before running; return a message to block. */
  validate?: (ctx: ToolContext) => string | null;
  run: (ctx: ToolContext, progress: (msg: string) => void) => Promise<ToolResult[]>;
  options?: (ctx: ToolContext) => ReactNode;
  /** Allow taking a photo with the device camera (Scan to PDF). */
  camera?: boolean;
  /** Hide the main button and show custom output instead (e.g. Compare). */
  children?: never;
}

const ACCEPT: Record<FileToolProps["kind"], string> = {
  pdf: "application/pdf,.pdf",
  image: "image/*,.jpg,.jpeg,.png,.webp,.gif,.bmp",
  excel: ".xlsx,.xls,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  word: ".doc,.docx,.odt,.rtf,.txt",
  ppt: ".ppt,.pptx,.odp",
};

const KIND_LABEL: Record<FileToolProps["kind"], string> = { pdf: "PDF", image: "image", excel: "Excel", word: "Word", ppt: "PowerPoint" };
const KIND_ERROR: Record<FileToolProps["kind"], string> = {
  pdf: "Please choose a PDF file.",
  image: "Please choose image files (JPG, PNG, WEBP...).",
  excel: "Please choose an Excel or CSV file.",
  word: "Please choose a Word document (.doc, .docx, .odt, .rtf or .txt).",
  ppt: "Please choose a PowerPoint file (.ppt, .pptx or .odp).",
};

const matches = (kind: FileToolProps["kind"], f: File) =>
  kind === "pdf"
    ? f.type === "application/pdf" || /\.pdf$/i.test(f.name)
    : kind === "image"
      ? f.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name)
      : kind === "excel"
        ? /\.(xlsx|xls|csv)$/i.test(f.name)
        : kind === "word"
          ? /\.(docx?|odt|rtf|txt)$/i.test(f.name)
          : /\.(pptx?|odp)$/i.test(f.name);

let itemCounter = 0;

/** Common page for every file tool: drop files, set options, run, download. */
export function FileTool(props: FileToolProps) {
  const tool = toolById(props.toolId)!;
  const { kind, multiple = false, minFiles = 1 } = props;
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [results, setResults] = useState<ToolResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(
    async (list: File[]) => {
      const ok = list.filter((f) => matches(kind, f));
      if (ok.length === 0) {
        setError(KIND_ERROR[kind]);
        return;
      }
      setError(null);
      setResults([]);
      const fresh: Item[] = (multiple ? ok : ok.slice(0, 1)).map((file) => ({ id: String(++itemCounter), file }));
      setItems((prev) => (multiple ? [...prev, ...fresh] : fresh));
      if (kind === "pdf") {
        for (const it of fresh) {
          try {
            const pdf = await openPdf(new Uint8Array(await it.file.arrayBuffer()), it.file.name);
            const pages = pdf.numPages;
            pdf.destroy();
            setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, pages } : p)));
          } catch (err: any) {
            setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, error: err.message } : p)));
          }
        }
      }
    },
    [kind, multiple],
  );

  function onInput(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    void addFiles(files);
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    void addFiles(Array.from(e.dataTransfer.files));
  }

  const ctx: ToolContext = { files: items.map((i) => i.file), pages: items.map((i) => i.pages ?? 0) };
  const broken = items.some((i) => i.error);

  async function go() {
    setError(null);
    setResults([]);
    const problem = props.validate?.(ctx);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setStatus("Working…");
    try {
      setResults(await props.run(ctx, setStatus));
    } catch (err: any) {
      console.error(err);
      setError(err?.message ?? "Something went wrong.");
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  async function downloadAll() {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    for (const r of results) zip.file(r.filename, r.blob);
    saveBlob(await zip.generateAsync({ type: "blob" }), `${tool.id}-files.zip`);
  }

  function move(index: number, dir: -1 | 1) {
    setItems((prev) => {
      const next = [...prev];
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }

  useEffect(() => {
    document.title = `${tool.title} | Free PDF tools`;
  }, [tool.title]);

  const ready = items.length >= minFiles && !broken && !busy;

  return (
    <div className="pt-tool">
      <div className="pt-tool-head">
        <h1>{tool.title}</h1>
        <p>{tool.desc}</p>
      </div>

      {results.length === 0 && (
        <>
          <div
            className={`pt-drop ${over ? "over" : ""} ${items.length ? "has-files" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
          >
            {items.length === 0 ? (
              <>
                <button type="button" className="pt-big" style={{ background: tool.color }} onClick={() => inputRef.current?.click()}>
                  Select {KIND_LABEL[kind]} file{multiple ? "s" : ""}
                </button>
                {props.camera && (
                  <button type="button" className="pt-ghost" onClick={() => cameraRef.current?.click()}>
                    Take a photo
                  </button>
                )}
                <p>or drop {multiple ? "files" : "a file"} here</p>
              </>
            ) : (
              <ul className="pt-files">
                {items.map((it, i) => (
                  <li key={it.id} className={it.error ? "bad" : ""}>
                    <span className="pt-file-name">{it.file.name}</span>
                    <span className="pt-file-meta">
                      {formatBytes(it.file.size)}
                      {it.pages ? ` · ${it.pages} page${it.pages === 1 ? "" : "s"}` : ""}
                    </span>
                    {it.error && <span className="pt-file-err">{it.error}</span>}
                    {multiple && items.length > 1 && (
                      <>
                        <button type="button" className="pt-mini" onClick={() => move(i, -1)} disabled={i === 0} title="Move up">
                          ↑
                        </button>
                        <button type="button" className="pt-mini" onClick={() => move(i, 1)} disabled={i === items.length - 1} title="Move down">
                          ↓
                        </button>
                      </>
                    )}
                    <button type="button" className="pt-mini" onClick={() => setItems((p) => p.filter((x) => x.id !== it.id))} title="Remove">
                      ✕
                    </button>
                  </li>
                ))}
                <li className="pt-add">
                  {multiple && (
                    <button type="button" className="pt-ghost" onClick={() => inputRef.current?.click()}>
                      + Add more files
                    </button>
                  )}
                  {props.camera && (
                    <button type="button" className="pt-ghost" onClick={() => cameraRef.current?.click()}>
                      + Take a photo
                    </button>
                  )}
                </li>
              </ul>
            )}
          </div>

          {items.length > 0 && props.options && <div className="pt-options">{props.options(ctx)}</div>}
          {error && <div className="pt-error">{error}</div>}

          {items.length > 0 && (
            <div className="pt-run">
              <button type="button" className="pt-big" style={{ background: tool.color }} disabled={!ready} onClick={go}>
                {busy ? status || "Working…" : props.action}
              </button>
              {items.length < minFiles && <p className="pt-hint">Add at least {minFiles} files.</p>}
            </div>
          )}
        </>
      )}

      {results.length > 0 && (
        <div className="pt-result">
          <h2>Done! Your {results.length > 1 ? "files are" : "file is"} ready.</h2>
          {results.map((r, i) => (
            <div key={i} className="pt-result-row">
              <span className="pt-file-name">{r.filename}</span>
              <span className="pt-file-meta">{formatBytes(r.blob.size)}</span>
              {r.note && <span className="pt-note">{r.note}</span>}
              <button type="button" className="pt-big sm" style={{ background: tool.color }} onClick={() => saveBlob(r.blob, r.filename)}>
                Download
              </button>
            </div>
          ))}
          {results.length > 1 && (
            <button type="button" className="pt-big" style={{ background: tool.color }} onClick={downloadAll}>
              Download all as ZIP
            </button>
          )}
          <button
            type="button"
            className="pt-ghost"
            onClick={() => {
              setResults([]);
              setItems([]);
            }}
          >
            Start over
          </button>
        </div>
      )}

      <input ref={inputRef} type="file" hidden multiple={multiple} accept={ACCEPT[kind]} onChange={onInput} />
      <input ref={cameraRef} type="file" hidden accept="image/*" capture="environment" onChange={onInput} />
      <p className="pt-privacy">{props.privacy ?? "Your files are processed inside your browser and are never uploaded to our servers."}</p>
    </div>
  );
}

export { baseName };
