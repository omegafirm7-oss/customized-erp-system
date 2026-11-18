import { ComponentType, LazyExoticComponent, Suspense, lazy, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { CATEGORIES, CategoryId, TOOLS, ToolMeta, toolById } from "./catalog";
import { ToolIcon } from "./ui";

const org = () => import("./organizeTools");
const conv = () => import("./convertTools");

const REGISTRY: Record<string, LazyExoticComponent<ComponentType>> = {
  merge: lazy(() => org().then((m) => ({ default: m.MergeTool }))),
  split: lazy(() => org().then((m) => ({ default: m.SplitTool }))),
  "remove-pages": lazy(() => org().then((m) => ({ default: m.RemovePagesTool }))),
  "extract-pages": lazy(() => org().then((m) => ({ default: m.ExtractPagesTool }))),
  rotate: lazy(() => org().then((m) => ({ default: m.RotateTool }))),
  "page-numbers": lazy(() => org().then((m) => ({ default: m.PageNumbersTool }))),
  watermark: lazy(() => org().then((m) => ({ default: m.WatermarkTool }))),
  crop: lazy(() => org().then((m) => ({ default: m.CropTool }))),
  compress: lazy(() => org().then((m) => ({ default: m.CompressTool }))),
  repair: lazy(() => org().then((m) => ({ default: m.RepairTool }))),
  "jpg-to-pdf": lazy(() => conv().then((m) => ({ default: () => <m.ImagesToPdfTool /> }))),
  scan: lazy(() => conv().then((m) => ({ default: () => <m.ImagesToPdfTool scan /> }))),
  "excel-to-pdf": lazy(() => conv().then((m) => ({ default: m.ExcelToPdfTool }))),
  "word-to-pdf": lazy(() => import("./serverTools").then((m) => ({ default: m.WordToPdfTool }))),
  "powerpoint-to-pdf": lazy(() => import("./serverTools").then((m) => ({ default: m.PowerpointToPdfTool }))),
  "html-to-pdf": lazy(() => import("./serverTools").then((m) => ({ default: m.HtmlToPdfTool }))),
  "pdf-to-jpg": lazy(() => conv().then((m) => ({ default: m.PdfToJpgTool }))),
  "pdf-to-word": lazy(() => conv().then((m) => ({ default: m.PdfToWordTool }))),
  "pdf-to-powerpoint": lazy(() => conv().then((m) => ({ default: m.PdfToPowerpointTool }))),
  "pdf-to-excel": lazy(() => conv().then((m) => ({ default: m.PdfToExcelTool }))),
  "pdf-to-markdown": lazy(() => conv().then((m) => ({ default: m.PdfToMarkdownTool }))),
  compare: lazy(() => conv().then((m) => ({ default: m.CompareTool }))),
  edit: lazy(() => import("../pages/PdfEditorPage").then((m) => ({ default: m.PdfEditorPage }))),
};

const toolHref = (t: ToolMeta) => `/free-pdf-editor/${t.to ?? t.id}`;

function MegaMenu({ onClose }: { onClose: () => void }) {
  return (
    <div className="pt-mega" onClick={onClose}>
      {CATEGORIES.map((c) => (
        <div key={c.id} className="pt-mega-col">
          <h4>{c.label}</h4>
          {TOOLS.filter((t) => t.category === c.id).map((t) =>
            t.ready ? (
              <Link key={t.id} to={toolHref(t)}>
                <ToolIcon tool={t} size={22} /> {t.title}
              </Link>
            ) : (
              <span key={t.id} className="soon">
                <ToolIcon tool={t} size={22} /> {t.title} <em>Soon</em>
              </span>
            ),
          )}
        </div>
      ))}
    </div>
  );
}

function Header() {
  const { user } = useAuth();
  const [open, setOpen] = useState<null | "convert" | "all">(null);
  const ref = useRef<HTMLElement>(null);
  const loc = useLocation();
  useEffect(() => setOpen(null), [loc.pathname]);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);
  const home = user ? "/companies" : "/login";
  return (
    <header className="pt-header" ref={ref}>
      <div className="pt-header-row">
        <Link to="/free-pdf-editor" className="pt-brand">
          <span className="pt-brand-mark">PDF</span> Universa Centrix
        </Link>
        <nav className="pt-nav">
          <Link to="/free-pdf-editor/merge">MERGE PDF</Link>
          <Link to="/free-pdf-editor/split">SPLIT PDF</Link>
          <Link to="/free-pdf-editor/compress">COMPRESS PDF</Link>
          <button type="button" className={open === "convert" ? "on" : ""} onClick={() => setOpen(open === "convert" ? null : "convert")}>
            CONVERT PDF ▾
          </button>
          <button type="button" className={`all ${open === "all" ? "on" : ""}`} onClick={() => setOpen(open === "all" ? null : "all")}>
            ALL PDF TOOLS {open === "all" ? "▴" : "▾"}
          </button>
        </nav>
        <span style={{ flex: 1 }} />
        <Link to={home} className="pt-signin">
          {user ? "Back to Universa" : "Sign in"}
        </Link>
      </div>
      {open === "convert" && (
        <div className="pt-drop-menu" onClick={() => setOpen(null)}>
          {TOOLS.filter((t) => t.category === "to-pdf" || t.category === "from-pdf").map((t) =>
            t.ready ? (
              <Link key={t.id} to={toolHref(t)}>
                {t.title}
              </Link>
            ) : (
              <span key={t.id} className="soon">
                {t.title} <em>Soon</em>
              </span>
            ),
          )}
        </div>
      )}
      {open === "all" && <MegaMenu onClose={() => setOpen(null)} />}
    </header>
  );
}

function Hub() {
  const [cat, setCat] = useState<"all" | CategoryId>("all");
  useEffect(() => {
    document.title = "Free PDF tools | Universa Centrix";
  }, []);
  const list = TOOLS.filter((t) => cat === "all" || t.category === cat);
  return (
    <div className="pt-hub">
      <h1>Every tool you need to work with PDFs in one place</h1>
      <p>Merge, split, compress, convert, edit and sign PDFs. Free, and nothing leaves your computer.</p>
      <div className="pt-chips">
        <button type="button" className={cat === "all" ? "on" : ""} onClick={() => setCat("all")}>
          All
        </button>
        {CATEGORIES.map((c) => (
          <button key={c.id} type="button" className={cat === c.id ? "on" : ""} onClick={() => setCat(c.id)}>
            {c.label.replace(" PDF", "")}
          </button>
        ))}
      </div>
      <div className="pt-cards">
        {list.map((t) => {
          const inner = (
            <>
              <ToolIcon tool={t} size={52} />
              <h3>{t.title}</h3>
              <p>{t.desc}</p>
              {!t.ready && <span className="pt-soon">Soon</span>}
            </>
          );
          return t.ready ? (
            <Link key={t.id} to={toolHref(t)} className="pt-card">
              {inner}
            </Link>
          ) : (
            <div key={t.id} className="pt-card disabled" title="Needs a server-side conversion engine. Coming soon.">
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PdfToolsApp() {
  const { toolId } = useParams();
  const meta = toolId ? toolById(toolId) : undefined;
  const Tool = toolId ? REGISTRY[toolId] : undefined;
  return (
    <div className="pt-app">
      <Header />
      <main className={`pt-main ${toolId === "edit" ? "wide" : ""}`}>
        {!toolId && <Hub />}
        {toolId && Tool && (
          <Suspense fallback={<p className="pt-loading">Loading…</p>}>
            <Tool />
          </Suspense>
        )}
        {toolId && !Tool && (
          <div className="pt-tool">
            <div className="pt-tool-head">
              <h1>{meta?.title ?? "Tool not found"}</h1>
              <p>{meta ? "This tool needs a server-side conversion engine and is coming soon." : "We couldn't find that tool."}</p>
              <Link to="/free-pdf-editor" className="pt-ghost">
                See all PDF tools
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
