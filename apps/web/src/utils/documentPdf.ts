import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { downloadsAllowed } from "./downloadGate";
import { DocumentBranding, logoFormatFromDataUrl } from "./attendancePdf";

const VAT_RATE: Record<string, number> = { STANDARD_15: 15, ZERO_RATED: 0, EXEMPT: 0, PK_STANDARD: 18, PK_THIRD_SCHEDULE: 18, PK_REDUCED: 0 };

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return [16, 24, 40];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function money(v: number): string {
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export interface CommercialDocumentLine {
  itemCode?: string | null;
  description: string;
  quantity: string | number;
  unitPrice: string | number;
  vatCategory?: string | null;
  /** Server-computed amounts (posted invoices). When present they are used
   * verbatim instead of the client-side estimate — required for Pakistan
   * (reduced rates, Third Schedule, further tax) and for discounts. */
  amounts?: { net: string | number; tax: string | number; rate: string | number; gross: string | number; furtherTax?: string | number };
}

/**
 * Tax-authority fiscal block (Pakistan FBR Digital Invoicing): FBR invoice
 * number + 1"×1" QR + the FBR DI logo, as required by PRAL DI spec §6.
 */
export interface FiscalBlock {
  authority: "FBR";
  invoiceNumber: string | null;
  qrDataUrl: string | null;
  logoDataUrl: string | null;
  /** Non-production reporting environment → printed as a warning. */
  testEnvironment: string | null;
}

/** A table that replaces the priced line grid + totals (requisitions, goods receipts: quantities, no money). */
export interface PlainTable {
  head: string[];
  body: string[][];
  /** Column indexes to right-align (numbers). */
  rightAlign?: number[];
}

/** What every document type adds on top of the shared layout: its identity, links to other documents, sign-off boxes. */
export interface CommercialDocumentExtras {
  /** Record status as stored (DRAFT, POSTED, APPROVED...). Printed in the header and footer; DRAFT/CANCELLED get a watermark. */
  status?: string | null;
  /** The record's id — printed in the footer and folded into the audit fingerprint, so each printout points at exactly one record. */
  recordId?: string | null;
  /** Label/value pairs shown under the header: source documents, project, required-by date, warehouse... */
  references?: Array<[string, string]>;
  /** Free-text note printed below the table (memo, rejection reason). */
  notes?: string | null;
  /** Sign-off boxes at the bottom. Defaults to Prepared / Checked / Approved. */
  signatures?: string[];
  /** Replaces the priced grid and totals. */
  plainTable?: PlainTable;
}

export interface CommercialDocumentParams extends CommercialDocumentExtras {
  cycle: "sales" | "purchase";
  companyName: string;
  companyAddress?: string | null;
  companyTaxNumber?: string | null;
  companyCrNumber?: string | null;
  currency?: string | null;
  docTypeLabel: string;
  documentNumber: string | null;
  documentDate: string;
  /** Omit for internal documents (requisitions) that have no counterparty. */
  partnerLabel?: string;
  partner?: { name: string; code: string; taxRegistrationNumber?: string | null };
  lines: CommercialDocumentLine[];
  /** "VAT" (default) or "Sales Tax" (Pakistan). */
  taxLabel?: string;
  /** Header label for the seller tax id, e.g. "VAT Reg. No" or "NTN". */
  taxNumberLabel?: string;
  fiscal?: FiscalBlock | null;
  branding?: DocumentBranding & {
    showAddress?: boolean;
    showTaxNumber?: boolean;
    showItemCode?: boolean;
    showVatBreakdown?: boolean;
    termsText?: string | null;
  };
}

const DEFAULT_SIGNATURES = ["Prepared by", "Checked by", "Approved by"];
const WATERMARK_STATUSES = new Set(["DRAFT", "CANCELLED", "REJECTED", "VOID"]);

/** SHA-256 of the printed content, shown in the footer. Same record + same content ⇒ same code; any later edit changes it. */
async function fingerprint(parts: string[]): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(parts.join("␟"));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
    return `${hex.slice(0, 8)}-${hex.slice(8, 16)}-${hex.slice(16, 24)}`;
  } catch {
    return "unavailable";
  }
}

function printedStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The single standard layout for every purchase and sales document (requisition, RFQ/quotation, order, goods
 * receipt, invoice): company letterhead with logo, document identity and status, references to the linked
 * documents, the lines, sign-off boxes, and an audit footer on every page (document number, status, print time,
 * record id, content fingerprint, page x of y).
 */
export async function downloadCommercialDocumentPdf(params: CommercialDocumentParams) {
  if (!downloadsAllowed()) return;
  const { companyName, companyAddress, companyTaxNumber, companyCrNumber, docTypeLabel, documentDate, lines, branding } = params;
  const partner = params.partner;
  const partnerLabel = params.partnerLabel ?? "Counterparty";
  const taxLabel = params.taxLabel ?? "VAT";
  const showItemCode = branding?.showItemCode ?? true;
  const showVatBreakdown = branding?.showVatBreakdown ?? true;
  const accent = hexToRgb(branding?.accentColor ?? "#101828");
  const currency = params.currency ? ` (${params.currency})` : "";
  const status = (params.status ?? "").toUpperCase();
  const documentNumber = params.documentNumber?.trim() || "";
  const numberLabel = documentNumber || "UNNUMBERED DRAFT";

  const computedLines = lines.map((line) => {
    const quantity = Number(line.quantity);
    const unitPrice = Number(line.unitPrice);
    if (line.amounts) {
      const a = line.amounts;
      return { ...line, quantity, unitPrice, net: Number(a.net), rate: Number(a.rate), vat: Number(a.tax), gross: Number(a.gross), furtherTax: Number(a.furtherTax ?? 0) };
    }
    const net = quantity * unitPrice;
    const rate = VAT_RATE[line.vatCategory ?? "STANDARD_15"] ?? 15;
    const vat = net * (rate / 100);
    return { ...line, quantity, unitPrice, net, rate, vat, gross: net + vat, furtherTax: 0 };
  });
  const totalNet = computedLines.reduce((s, l) => s + l.net, 0);
  const totalVat = computedLines.reduce((s, l) => s + l.vat, 0);
  const totalFurtherTax = computedLines.reduce((s, l) => s + l.furtherTax, 0);
  const totalGross = totalNet + totalVat;

  const fp = await fingerprint([
    docTypeLabel,
    numberLabel,
    params.recordId ?? "",
    documentDate,
    partner?.code ?? "",
    status,
    ...(params.plainTable ? params.plainTable.body.map((r) => r.join("|")) : computedLines.map((l) => `${l.description}|${l.quantity}|${l.unitPrice}|${l.gross}`)),
    params.plainTable ? "" : totalGross.toFixed(2),
  ]);

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const left = 14;
  const right = pageWidth - 14;
  const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  // ---- Letterhead: logo + company block on the left, document identity on the right.
  let textX = left;
  if (branding?.logoDataUrl) {
    try {
      doc.addImage(branding.logoDataUrl, logoFormatFromDataUrl(branding.logoDataUrl), left, 10, 30, 18, undefined, "FAST");
      textX = left + 34;
    } catch {
      // carry on without the logo if the data URL can't be decoded
    }
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...accent);
  doc.text(companyName.toUpperCase(), textX, 15);
  let lineY = 20;
  doc.setFontSize(8);
  doc.setTextColor(200, 40, 40);
  if (branding?.headerTagline) {
    doc.text(branding.headerTagline.toUpperCase(), textX, lineY);
    lineY += 4;
  }
  if (branding?.headerMissionLine) {
    doc.text(branding.headerMissionLine, textX, lineY);
    lineY += 4;
  }
  doc.setFont("helvetica", "normal");
  doc.setTextColor(90, 90, 90);
  doc.setFontSize(8);
  if ((branding?.showAddress ?? true) && companyAddress) {
    doc.text(doc.splitTextToSize(companyAddress, 100), textX, lineY);
    lineY += 4 * Math.min(2, doc.splitTextToSize(companyAddress, 100).length);
  }
  const ids: string[] = [];
  if ((branding?.showTaxNumber ?? true) && companyTaxNumber) ids.push(`${params.taxNumberLabel ?? "VAT Reg. No"}: ${companyTaxNumber}`);
  if (companyCrNumber) ids.push(`CR No: ${companyCrNumber}`);
  if (ids.length) {
    doc.text(ids.join("   |   "), textX, lineY);
    lineY += 4;
  }

  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(docTypeLabel.toUpperCase(), right, 15, { align: "right" });
  doc.setFontSize(11);
  doc.text(numberLabel, right, 21, { align: "right" });
  if (status) {
    doc.setFontSize(8);
    doc.setTextColor(...accent);
    doc.text(`STATUS: ${status.replace(/_/g, " ")}`, right, 26, { align: "right" });
    doc.setTextColor(0, 0, 0);
  }

  let y = Math.max(32, lineY + 2);
  doc.setDrawColor(...accent);
  doc.setLineWidth(0.8);
  doc.line(left, y, right, y);
  y += 5;

  // ---- Identity + parties + references.
  const meta: string[][] = [
    ["Document No.", numberLabel, "Date", new Date(documentDate).toLocaleDateString()],
  ];
  if (partner) meta.push([partnerLabel, partner.name, `${partnerLabel} Code`, partner.code]);
  if (partner?.taxRegistrationNumber) meta.push([`${partnerLabel} ${taxLabel} No`, partner.taxRegistrationNumber, "", ""]);
  const refs = params.references ?? [];
  for (let i = 0; i < refs.length; i += 2) meta.push([refs[i][0], refs[i][1], refs[i + 1]?.[0] ?? "", refs[i + 1]?.[1] ?? ""]);
  autoTable(doc, {
    startY: y,
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 2, lineColor: [200, 200, 200] },
    body: meta,
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 35, fillColor: [245, 246, 248] },
      1: { cellWidth: 55 },
      2: { fontStyle: "bold", cellWidth: 35, fillColor: [245, 246, 248] },
      3: { cellWidth: 57 },
    },
    margin: { left, right: 14 },
  });
  y = lastY() + 6;

  // ---- Lines.
  if (params.plainTable) {
    const pt = params.plainTable;
    const alignRight = Object.fromEntries((pt.rightAlign ?? []).map((i) => [i, { halign: "right" as const }]));
    autoTable(doc, {
      startY: y,
      head: [pt.head],
      body: pt.body,
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: accent },
      columnStyles: alignRight,
      margin: { left, right: 14 },
    });
    y = lastY() + 6;
  } else {
    const head = showItemCode
      ? ["#", "Code", "Description", "Qty", "Unit Price", ...(showVatBreakdown ? [`${taxLabel} %`, taxLabel] : []), "Line Total"]
      : ["#", "Description", "Qty", "Unit Price", ...(showVatBreakdown ? [`${taxLabel} %`, taxLabel] : []), "Line Total"];
    const body = computedLines.map((l, i) => {
      const row: string[] = [String(i + 1)];
      if (showItemCode) row.push(l.itemCode ?? "");
      row.push(l.description, String(l.quantity), money(l.unitPrice));
      if (showVatBreakdown) row.push(`${l.rate}%`, money(l.vat));
      row.push(money(l.gross));
      return row;
    });
    const numericFrom = showItemCode ? 3 : 2;
    const rightCols = Object.fromEntries(Array.from({ length: head.length - numericFrom }, (_, k) => [numericFrom + k, { halign: "right" as const }]));
    autoTable(doc, {
      startY: y,
      head: [head],
      body,
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: accent },
      columnStyles: { 0: { cellWidth: 9 }, ...(showItemCode ? { 1: { cellWidth: 22 } } : {}), ...rightCols },
      margin: { left, right: 14 },
    });
    y = lastY() + 4;

    const totalsBody = showVatBreakdown
      ? [
          [`Net Total${currency}`, money(totalNet)],
          ...(totalFurtherTax > 0
            ? [
                [`${taxLabel} Total`, money(totalVat - totalFurtherTax)],
                ["Further Tax", money(totalFurtherTax)],
              ]
            : [[`${taxLabel} Total`, money(totalVat)]]),
          ["Grand Total", money(totalGross)],
        ]
      : [[`Grand Total${currency}`, money(totalGross)]];
    autoTable(doc, {
      startY: y,
      theme: "plain",
      styles: { fontSize: 10, cellPadding: 2, halign: "right" },
      body: totalsBody,
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 45 }, 1: { cellWidth: 35 } },
      margin: { left: pageWidth - 14 - 80, right: 14 },
    });
    y = lastY() + 8;
  }

  const ensureRoom = (needed: number) => {
    if (y + needed > pageHeight - 24) {
      doc.addPage();
      y = 20;
    }
  };

  if (params.fiscal) {
    ensureRoom(40);
    y = drawFiscalBlock(doc, params.fiscal, y, pageWidth);
  }

  if (params.notes) {
    ensureRoom(18);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);
    doc.text("Notes", left, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    const wrapped = doc.splitTextToSize(params.notes, pageWidth - 28);
    doc.text(wrapped, left, y);
    y += wrapped.length * 4.2 + 4;
  }

  if (branding?.termsText) {
    ensureRoom(24);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);
    doc.text("Terms & Conditions", left, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    const wrapped = doc.splitTextToSize(branding.termsText, pageWidth - 28);
    doc.text(wrapped, left, y);
    y += wrapped.length * 4.2 + 4;
  }

  // ---- Sign-off boxes.
  const signatures = params.signatures?.length ? params.signatures : DEFAULT_SIGNATURES;
  ensureRoom(34);
  y += 6;
  const gap = 6;
  const boxW = (pageWidth - 28 - gap * (signatures.length - 1)) / signatures.length;
  doc.setDrawColor(120, 120, 120);
  doc.setLineWidth(0.3);
  signatures.forEach((label, i) => {
    const x = left + i * (boxW + gap);
    doc.line(x, y + 14, x + boxW, y + 14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(0, 0, 0);
    doc.text(label, x, y + 18.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(110, 110, 110);
    doc.text("Name / Signature / Date", x, y + 22.5);
  });

  // ---- Every page: watermark for non-final records, audit footer, page x of y.
  const pages = doc.getNumberOfPages();
  const watermark = !documentNumber ? "DRAFT" : WATERMARK_STATUSES.has(status) ? status : "";
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    if (watermark) {
      doc.saveGraphicsState();
      doc.setGState(new (doc as any).GState({ opacity: 0.07 }));
      doc.setTextColor(120, 0, 0);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(90);
      doc.text(watermark, pageWidth / 2, pageHeight / 2 + 10, { align: "center", angle: 35 });
      doc.restoreGraphicsState();
    }
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(left, pageHeight - 20, right, pageHeight - 20);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(90, 90, 90);
    if (branding?.footerText) doc.text(branding.footerText, left, pageHeight - 16.5);
    doc.text(`${docTypeLabel} ${numberLabel}${status ? ` · ${status.replace(/_/g, " ")}` : ""}`, left, pageHeight - 12);
    doc.text(`Printed ${printedStamp()}`, pageWidth / 2, pageHeight - 12, { align: "center" });
    doc.text(`Page ${p} of ${pages}`, right, pageHeight - 12, { align: "right" });
    doc.text(`Audit ref ${fp}${params.recordId ? `   ·   Record ${params.recordId}` : ""}`, left, pageHeight - 8);
    doc.setTextColor(0, 0, 0);
  }

  doc.save(`${(documentNumber || `${docTypeLabel}-draft`).replace(/\s+/g, "-")}.pdf`);
}

/** 1 inch = 25.4 mm (jsPDF default unit is mm) — FBR mandates a 1"×1" QR. */
const INCH = 25.4;

function drawFiscalBlock(doc: jsPDF, fiscal: FiscalBlock, y: number, pageWidth: number): number {
  const top = y;
  let x = 14;
  if (fiscal.logoDataUrl) {
    try {
      doc.addImage(fiscal.logoDataUrl, logoFormatFromDataUrl(fiscal.logoDataUrl), x, top, INCH, INCH, undefined, "FAST");
      x += INCH + 4;
    } catch {
      // print without the logo rather than fail the whole PDF
    }
  }
  if (fiscal.qrDataUrl) {
    doc.addImage(fiscal.qrDataUrl, "PNG", x, top, INCH, INCH, undefined, "FAST");
    x += INCH + 5;
  }
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 0, 0);
  doc.text("FBR Digital Invoicing", x, top + 5);
  doc.setFont("helvetica", "normal");
  if (fiscal.invoiceNumber) {
    doc.text(`FBR Invoice No: ${fiscal.invoiceNumber}`, x, top + 11);
    doc.text("Scan the QR code to verify this invoice with FBR.", x, top + 16, { maxWidth: pageWidth - x - 14 });
  } else {
    doc.setTextColor(180, 35, 24);
    doc.text("NOT YET REPORTED TO FBR — no FBR invoice number issued.", x, top + 11, { maxWidth: pageWidth - x - 14 });
    doc.setTextColor(0, 0, 0);
  }
  if (fiscal.testEnvironment) {
    doc.setTextColor(180, 35, 24);
    doc.setFont("helvetica", "bold");
    doc.text(`TEST (${fiscal.testEnvironment}) — NOT A VALID TAX INVOICE`, x, top + 22, { maxWidth: pageWidth - x - 14 });
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0, 0, 0);
  }
  return top + INCH + 8;
}
