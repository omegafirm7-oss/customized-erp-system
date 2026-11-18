export type CategoryId = "organize" | "optimize" | "to-pdf" | "from-pdf" | "edit" | "security" | "intelligence";

export const CATEGORIES: Array<{ id: CategoryId; label: string }> = [
  { id: "organize", label: "Organize PDF" },
  { id: "optimize", label: "Optimize PDF" },
  { id: "to-pdf", label: "Convert to PDF" },
  { id: "from-pdf", label: "Convert from PDF" },
  { id: "edit", label: "Edit PDF" },
  { id: "security", label: "PDF Security" },
  { id: "intelligence", label: "PDF Intelligence" },
];

export type IconKey =
  | "merge" | "split" | "remove" | "extract" | "organize" | "scan" | "compress" | "repair" | "ocr"
  | "image" | "word" | "ppt" | "excel" | "html" | "pdfa" | "rotate" | "numbers" | "watermark" | "crop"
  | "edit" | "forms" | "unlock" | "protect" | "sign" | "redact" | "compare" | "summary" | "translate" | "markdown";

export interface ToolMeta {
  id: string;
  title: string;
  desc: string;
  category: CategoryId;
  color: string;
  icon: IconKey;
  /** false = needs a server-side conversion engine, shown as "Soon". */
  ready: boolean;
  /** Opens another page of the toolkit instead of its own (for tools served by the editor). */
  to?: string;
}

const T = (t: ToolMeta) => t;

export const TOOLS: ToolMeta[] = [
  T({ id: "merge", title: "Merge PDF", desc: "Combine PDFs in the order you want with the easiest PDF merger available.", category: "organize", color: "#e5532d", icon: "merge", ready: true }),
  T({ id: "split", title: "Split PDF", desc: "Separate one page or a whole set for easy conversion into independent PDF files.", category: "organize", color: "#e5532d", icon: "split", ready: true }),
  T({ id: "remove-pages", title: "Remove pages", desc: "Delete the pages you don't need from a PDF and keep the rest.", category: "organize", color: "#e5532d", icon: "remove", ready: true }),
  T({ id: "extract-pages", title: "Extract pages", desc: "Pull selected pages out of a PDF into a new document.", category: "organize", color: "#e5532d", icon: "extract", ready: true }),
  T({ id: "organize", title: "Organize PDF", desc: "Sort, rotate, delete and add pages to your PDF. Drag thumbnails into the order you want.", category: "organize", color: "#e5532d", icon: "organize", ready: true, to: "edit" }),
  T({ id: "scan", title: "Scan to PDF", desc: "Capture document scans from your phone or computer camera and send them straight to PDF.", category: "organize", color: "#e5532d", icon: "scan", ready: true }),

  T({ id: "compress", title: "Compress PDF", desc: "Reduce the file size of your PDF while keeping it readable.", category: "optimize", color: "#4caf50", icon: "compress", ready: true }),
  T({ id: "repair", title: "Repair PDF", desc: "Recover the data from a damaged or corrupted PDF where possible.", category: "optimize", color: "#4caf50", icon: "repair", ready: true }),
  T({ id: "ocr", title: "OCR PDF", desc: "Turn scanned PDFs into searchable, selectable text.", category: "optimize", color: "#4caf50", icon: "ocr", ready: false }),

  T({ id: "jpg-to-pdf", title: "JPG to PDF", desc: "Convert JPG, PNG and other images to PDF in seconds. Easily adjust orientation and margins.", category: "to-pdf", color: "#f5c518", icon: "image", ready: true }),
  T({ id: "word-to-pdf", title: "Word to PDF", desc: "Make DOC and DOCX files easy to read by converting them to PDF.", category: "to-pdf", color: "#2b6cb0", icon: "word", ready: false }),
  T({ id: "powerpoint-to-pdf", title: "PowerPoint to PDF", desc: "Make PPT and PPTX slideshows easy to view by converting them to PDF.", category: "to-pdf", color: "#e5532d", icon: "ppt", ready: false }),
  T({ id: "excel-to-pdf", title: "Excel to PDF", desc: "Make Excel spreadsheets easy to read by converting them to PDF.", category: "to-pdf", color: "#2f9e5b", icon: "excel", ready: true }),
  T({ id: "html-to-pdf", title: "HTML to PDF", desc: "Convert webpages and HTML files to PDF.", category: "to-pdf", color: "#f5c518", icon: "html", ready: false }),

  T({ id: "pdf-to-jpg", title: "PDF to JPG", desc: "Convert each PDF page into a JPG image at the quality you choose.", category: "from-pdf", color: "#f5c518", icon: "image", ready: true }),
  T({ id: "pdf-to-word", title: "PDF to Word", desc: "Convert PDF text into an editable Word document (text-based PDFs).", category: "from-pdf", color: "#2b6cb0", icon: "word", ready: true }),
  T({ id: "pdf-to-powerpoint", title: "PDF to PowerPoint", desc: "Turn every PDF page into a PowerPoint slide.", category: "from-pdf", color: "#e5532d", icon: "ppt", ready: true }),
  T({ id: "pdf-to-excel", title: "PDF to Excel", desc: "Pull tables and text from a PDF into an Excel spreadsheet.", category: "from-pdf", color: "#2f9e5b", icon: "excel", ready: true }),
  T({ id: "pdf-to-pdfa", title: "PDF to PDF/A", desc: "Convert a PDF to PDF/A, the ISO standard for long-term archiving.", category: "from-pdf", color: "#2b6cb0", icon: "pdfa", ready: false }),

  T({ id: "rotate", title: "Rotate PDF", desc: "Rotate your PDFs the way you need them. You can even rotate selected pages.", category: "edit", color: "#9b59b6", icon: "rotate", ready: true }),
  T({ id: "page-numbers", title: "Add page numbers", desc: "Add page numbers into PDFs with ease. Choose position, format and typography.", category: "edit", color: "#9b59b6", icon: "numbers", ready: true }),
  T({ id: "watermark", title: "Add watermark", desc: "Stamp an image or text over your PDF in seconds. Choose typography, transparency and position.", category: "edit", color: "#9b59b6", icon: "watermark", ready: true }),
  T({ id: "crop", title: "Crop PDF", desc: "Trim the margins of your PDF pages to remove what you don't need.", category: "edit", color: "#9b59b6", icon: "crop", ready: true }),
  T({ id: "edit", title: "Edit PDF", desc: "Add text, images, shapes or freehand annotations. Edit existing text, size, font and colour.", category: "edit", color: "#9b59b6", icon: "edit", ready: true }),
  T({ id: "pdf-forms", title: "PDF Forms", desc: "Create and fill PDF forms.", category: "edit", color: "#9b59b6", icon: "forms", ready: false }),

  T({ id: "unlock", title: "Unlock PDF", desc: "Remove PDF password security, giving you the freedom to use your PDFs as you want.", category: "security", color: "#4a6fa5", icon: "unlock", ready: false }),
  T({ id: "protect", title: "Protect PDF", desc: "Protect PDF files with a password. Encrypt PDF documents to prevent unauthorized access.", category: "security", color: "#4a6fa5", icon: "protect", ready: false }),
  T({ id: "sign", title: "Sign PDF", desc: "Sign yourself or request electronic signatures from others.", category: "security", color: "#4a6fa5", icon: "sign", ready: true, to: "edit?sign=1" }),
  T({ id: "redact", title: "Redact PDF", desc: "Permanently black out or white out sensitive text and areas in a PDF.", category: "security", color: "#4a6fa5", icon: "redact", ready: true, to: "edit?tool=cover&flatten=1" }),
  T({ id: "compare", title: "Compare PDF", desc: "Show a side-by-side comparison and highlight the changes between two PDFs.", category: "security", color: "#4a6fa5", icon: "compare", ready: true }),

  T({ id: "ai-summarizer", title: "AI Summarizer", desc: "Summarise long PDFs into the key points in seconds.", category: "intelligence", color: "#6f4cff", icon: "summary", ready: false }),
  T({ id: "translate", title: "Translate PDF", desc: "Translate PDF documents into another language.", category: "intelligence", color: "#6f4cff", icon: "translate", ready: false }),
  T({ id: "pdf-to-markdown", title: "PDF to Markdown", desc: "Convert PDF text into clean Markdown with headings and lists.", category: "intelligence", color: "#6f4cff", icon: "markdown", ready: true }),
];

export const toolById = (id: string) => TOOLS.find((t) => t.id === id);
