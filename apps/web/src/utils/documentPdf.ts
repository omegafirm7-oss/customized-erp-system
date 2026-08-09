import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { DocumentBranding, logoFormatFromDataUrl } from "./attendancePdf";

const VAT_RATE: Record<string, number> = { STANDARD_15: 15, ZERO_RATED: 0, EXEMPT: 0 };

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
}

/**
 * One PDF generator shared by all 6 Sales/Purchase documents (Quotation,
 * Order, Invoice × Sales/Purchase cycle) — they're structurally identical
 * (partner block, line-item grid, totals, terms), only the cycle-specific
 * template-settings toggle set and the "Bill To"/"Vendor" label differ.
 */
export function downloadCommercialDocumentPdf(params: {
  cycle: "sales" | "purchase";
  companyName: string;
  companyAddress?: string | null;
  companyTaxNumber?: string | null;
  docTypeLabel: string;
  documentNumber: string;
  documentDate: string;
  partnerLabel: string;
  partner: { name: string; code: string; taxRegistrationNumber?: string | null };
  lines: CommercialDocumentLine[];
  branding?: DocumentBranding & {
    showAddress?: boolean;
    showTaxNumber?: boolean;
    showItemCode?: boolean;
    showVatBreakdown?: boolean;
    termsText?: string | null;
  };
}) {
  const { companyName, companyAddress, companyTaxNumber, docTypeLabel, documentNumber, documentDate, partnerLabel, partner, lines, branding } = params;
  const showItemCode = branding?.showItemCode ?? true;
  const showVatBreakdown = branding?.showVatBreakdown ?? true;
  const accentRgb = hexToRgb(branding?.accentColor ?? "#101828");

  const computedLines = lines.map((line) => {
    const quantity = Number(line.quantity);
    const unitPrice = Number(line.unitPrice);
    const net = quantity * unitPrice;
    const rate = VAT_RATE[line.vatCategory ?? "STANDARD_15"] ?? 15;
    const vat = net * (rate / 100);
    return { ...line, quantity, unitPrice, net, rate, vat, gross: net + vat };
  });
  const totalNet = computedLines.reduce((s, l) => s + l.net, 0);
  const totalVat = computedLines.reduce((s, l) => s + l.vat, 0);
  const totalGross = totalNet + totalVat;

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 16;

  if (branding?.logoDataUrl) {
    try {
      doc.addImage(branding.logoDataUrl, logoFormatFromDataUrl(branding.logoDataUrl), 14, y, 30, 16, undefined, "FAST");
    } catch {
      // fall through without the logo if the data URL can't be decoded
    }
  }

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(companyName, pageWidth - 14, y + 4, { align: "right" });
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  let headerY = y + 10;
  if ((branding?.showAddress ?? true) && companyAddress) {
    doc.text(companyAddress, pageWidth - 14, headerY, { align: "right" });
    headerY += 5;
  }
  if ((branding?.showTaxNumber ?? true) && companyTaxNumber) {
    doc.text(`VAT Reg. No: ${companyTaxNumber}`, pageWidth - 14, headerY, { align: "right" });
    headerY += 5;
  }
  y = Math.max(y + 24, headerY + 4);

  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text(docTypeLabel, 14, y);
  y += 7;

  autoTable(doc, {
    startY: y,
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 2 },
    body: [
      [`${docTypeLabel} No.`, documentNumber, "Date", new Date(documentDate).toLocaleDateString()],
      [partnerLabel, partner.name, `${partnerLabel} Code`, partner.code],
    ],
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 35 },
      1: { cellWidth: 55 },
      2: { fontStyle: "bold", cellWidth: 35 },
      3: { cellWidth: 55 },
    },
    margin: { left: 14, right: 14 },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  const head = showItemCode
    ? ["Code", "Description", "Qty", "Unit Price", ...(showVatBreakdown ? ["VAT %", "VAT"] : []), "Line Total"]
    : ["Description", "Qty", "Unit Price", ...(showVatBreakdown ? ["VAT %", "VAT"] : []), "Line Total"];
  const body = computedLines.map((l) => {
    const row: string[] = [];
    if (showItemCode) row.push(l.itemCode ?? "");
    row.push(l.description, String(l.quantity), money(l.unitPrice));
    if (showVatBreakdown) row.push(`${l.rate}%`, money(l.vat));
    row.push(money(l.gross));
    return row;
  });

  autoTable(doc, {
    startY: y,
    head: [head],
    body,
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: accentRgb },
    columnStyles: showItemCode ? { 0: { cellWidth: 22 } } : {},
    margin: { left: 14, right: 14 },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;

  const totalsBody = showVatBreakdown
    ? [
        ["Net Total", money(totalNet)],
        ["VAT Total", money(totalVat)],
        ["Grand Total", money(totalGross)],
      ]
    : [["Grand Total", money(totalGross)]];

  autoTable(doc, {
    startY: y,
    theme: "plain",
    styles: { fontSize: 10, cellPadding: 2, halign: "right" },
    body: totalsBody,
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 40 }, 1: { cellWidth: 40 } },
    margin: { left: pageWidth - 14 - 80, right: 14 },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  if (branding?.termsText) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("Terms & Conditions", 14, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.text(doc.splitTextToSize(branding.termsText, pageWidth - 28), 14, y);
    y += 10;
  }
  if (branding?.footerText) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(branding.footerText, 14, y);
  }

  doc.save(`${documentNumber.replace(/\s+/g, "-")}.pdf`);
}
