import { useEffect, useState } from "react";
import { baseName, formatBytes, saveBlob } from "./engine";
import { Field } from "./organizeTools";
import { FileTool } from "./ui";
import { toolById } from "./catalog";

const SERVER_NOTE = "To convert this, your file is sent to our server over a secure connection, converted, and deleted straight away. Nothing is stored.";

/** Calls one of the public converters on our server and returns the PDF. */
async function convertOnServer(path: string, form: FormData): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(`/api/public/convert/${path}`, { method: "POST", body: form });
  } catch {
    throw new Error("Could not reach the converter. Check your connection and try again.");
  }
  if (!res.ok) {
    if (res.status === 413) throw new Error("That file is too large for the converter.");
    let message = "The conversion failed. Please try again.";
    try {
      const j = await res.json();
      if (j?.message) message = Array.isArray(j.message) ? j.message.join(" ") : String(j.message);
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }
  return res.blob();
}

export function WordToPdfTool() {
  return (
    <FileTool
      toolId="word-to-pdf"
      kind="word"
      action="Convert to PDF"
      privacy={SERVER_NOTE}
      run={async ({ files }, progress) => {
        progress("Converting… this can take up to a minute");
        const form = new FormData();
        form.append("file", files[0]);
        const blob = await convertOnServer("word", form);
        return [{ blob, filename: `${baseName(files[0].name)}.pdf` }];
      }}
    />
  );
}

export function PowerpointToPdfTool() {
  return (
    <FileTool
      toolId="powerpoint-to-pdf"
      kind="ppt"
      action="Convert to PDF"
      privacy={SERVER_NOTE}
      run={async ({ files }, progress) => {
        progress("Converting… this can take up to a minute");
        const form = new FormData();
        form.append("file", files[0]);
        const blob = await convertOnServer("powerpoint", form);
        return [{ blob, filename: `${baseName(files[0].name)}.pdf` }];
      }}
    />
  );
}

export function HtmlToPdfTool() {
  const tool = toolById("html-to-pdf")!;
  const [mode, setMode] = useState<"url" | "file" | "code">("url");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [code, setCode] = useState("");
  const [pageSize, setPageSize] = useState<"A4" | "Letter">("A4");
  const [landscape, setLandscape] = useState(false);
  const [margin, setMargin] = useState("10");
  const [background, setBackground] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ blob: Blob; filename: string } | null>(null);

  useEffect(() => {
    document.title = `${tool.title} | Free PDF tools`;
  }, [tool.title]);

  const ready = !busy && ((mode === "url" && url.trim().length > 4) || (mode === "file" && !!file) || (mode === "code" && code.trim().length > 0));

  async function go() {
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      let filename = "page.pdf";
      if (mode === "url") {
        let u = url.trim();
        if (!/^https?:\/\//i.test(u)) u = "https://" + u;
        form.append("url", u);
        try {
          filename = new URL(u).hostname.replace(/^www\./, "") + ".pdf";
        } catch {
          /* default */
        }
      } else if (mode === "file") {
        form.append("file", file!);
        filename = `${baseName(file!.name)}.pdf`;
      } else {
        form.append("html", code);
        filename = "document.pdf";
      }
      form.append("pageSize", pageSize);
      form.append("landscape", String(landscape));
      form.append("margin", margin);
      form.append("background", String(background));
      setResult({ blob: await convertOnServer("html", form), filename });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pt-tool">
      <div className="pt-tool-head">
        <h1>{tool.title}</h1>
        <p>{tool.desc}</p>
      </div>

      {!result && (
        <>
          <div className="pt-options">
            <div className="pt-seg">
              <button type="button" className={mode === "url" ? "on" : ""} onClick={() => setMode("url")}>
                Web page address
              </button>
              <button type="button" className={mode === "file" ? "on" : ""} onClick={() => setMode("file")}>
                HTML file
              </button>
              <button type="button" className={mode === "code" ? "on" : ""} onClick={() => setMode("code")}>
                Paste HTML code
              </button>
            </div>
            {mode === "url" && (
              <Field label="Web address" hint="Public pages only. Pages that need a login can't be converted.">
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/article" inputMode="url" />
              </Field>
            )}
            {mode === "file" && (
              <Field label="HTML file (up to 5 MB)">
                <input type="file" accept=".html,.htm,text/html" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </Field>
            )}
            {mode === "code" && (
              <Field label="HTML code">
                <textarea rows={9} value={code} onChange={(e) => setCode(e.target.value)} placeholder="<h1>Hello</h1>" style={{ fontFamily: "monospace" }} />
              </Field>
            )}
            <div className="pt-grid">
              <Field label="Page size">
                <select value={pageSize} onChange={(e) => setPageSize(e.target.value as "A4" | "Letter")}>
                  <option value="A4">A4</option>
                  <option value="Letter">US Letter</option>
                </select>
              </Field>
              <Field label="Orientation">
                <select value={landscape ? "l" : "p"} onChange={(e) => setLandscape(e.target.value === "l")}>
                  <option value="p">Portrait</option>
                  <option value="l">Landscape</option>
                </select>
              </Field>
              <Field label="Margin">
                <select value={margin} onChange={(e) => setMargin(e.target.value)}>
                  <option value="0">None</option>
                  <option value="10">Small</option>
                  <option value="20">Big</option>
                </select>
              </Field>
            </div>
            <label className="pt-check">
              <input type="checkbox" checked={background} onChange={(e) => setBackground(e.target.checked)} /> Print background colours and images
            </label>
            <small className="pt-hint">Scripts on the page are not run, so content that only appears through JavaScript won't be included.</small>
          </div>
          {error && <div className="pt-error">{error}</div>}
          <div className="pt-run">
            <button type="button" className="pt-big" style={{ background: tool.color }} disabled={!ready} onClick={go}>
              {busy ? "Converting… this can take up to a minute" : "Convert to PDF"}
            </button>
          </div>
        </>
      )}

      {result && (
        <div className="pt-result">
          <h2>Done! Your file is ready.</h2>
          <div className="pt-result-row">
            <span className="pt-file-name">{result.filename}</span>
            <span className="pt-file-meta">{formatBytes(result.blob.size)}</span>
            <button type="button" className="pt-big sm" style={{ background: tool.color }} onClick={() => saveBlob(result.blob, result.filename)}>
              Download
            </button>
          </div>
          <button type="button" className="pt-ghost" onClick={() => setResult(null)}>
            Start over
          </button>
        </div>
      )}
      <p className="pt-privacy">{SERVER_NOTE}</p>
    </div>
  );
}
