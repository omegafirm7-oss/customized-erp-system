import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

/** Builds a simple PDF report client-side (title + optional KPI summary + one or more tables)
 * and triggers a browser download — mirrors downloadCsv's no-server-round-trip approach. */
export function downloadPdf(
  filename: string,
  title: string,
  sections: Array<{
    heading?: string;
    kpis?: Array<{ label: string; value: string }>;
    headers?: string[];
    rows?: Array<Array<string | number>>;
  }>,
) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 18;

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(title, 14, y);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(120);
  doc.text(new Date().toLocaleString(), pageWidth - 14, y, { align: "right" });
  doc.setTextColor(0);
  y += 8;

  for (const section of sections) {
    if (section.heading) {
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text(section.heading, 14, y);
      y += 6;
    }
    if (section.kpis && section.kpis.length > 0) {
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      for (const kpi of section.kpis) {
        doc.text(`${kpi.label}: ${kpi.value}`, 14, y);
        y += 5.5;
      }
      y += 2;
    }
    if (section.headers && section.rows) {
      autoTable(doc, {
        startY: y,
        head: [section.headers],
        body: section.rows,
        styles: { fontSize: 9 },
        headStyles: { fillColor: [16, 24, 40] },
        margin: { left: 14, right: 14 },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
    }
  }

  doc.save(filename);
}
