import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const DAY_TYPE_REMARKS: Record<string, string> = {
  REST: "Rest",
  ABSENT: "Absent",
  UNPAID_LEAVE: "Unpaid Leave",
  ANNUAL_LEAVE: "Annual Leave",
};

interface AttendanceEntry {
  date: string;
  dayType: string;
  hoursWorked: string | number;
}

export interface DocumentBranding {
  logoDataUrl?: string | null;
  accentColor?: string;
  footerText?: string | null;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return [16, 24, 40];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

export function logoFormatFromDataUrl(dataUrl: string): "PNG" | "JPEG" | "WEBP" {
  if (dataUrl.startsWith("data:image/jpeg")) return "JPEG";
  if (dataUrl.startsWith("data:image/webp")) return "WEBP";
  return "PNG";
}

/**
 * Renders one employee's day-by-day attendance for a single period into a
 * letterhead-styled PDF matching the client's official monthly timesheet
 * template (S/N, Date, Hours, Remarks; Fridays blank; total at the bottom).
 * One row per calendar day in [startDate, endDate], not just days that have
 * a recorded entry — matches the printed sheet's fixed 1..31 row layout.
 */
export function downloadEmployeeAttendancePdf(params: {
  companyName: string;
  employeeName: string;
  employeeCode: string;
  designation?: string;
  iqamaOrNationalId?: string;
  periodLabel: string;
  startDate: string;
  endDate: string;
  entries: AttendanceEntry[];
  totalHours: string | number;
  branding?: DocumentBranding & {
    title?: string;
    showIqama?: boolean;
    showDesignation?: boolean;
  };
}) {
  const { companyName, employeeName, employeeCode, designation, iqamaOrNationalId, periodLabel, startDate, endDate, entries, totalHours, branding } = params;
  const title = branding?.title ?? "Monthly Timesheet";
  const showIqama = branding?.showIqama ?? true;
  const showDesignation = branding?.showDesignation ?? true;
  const accentRgb = hexToRgb(branding?.accentColor ?? "#101828");

  const entryByDate = new Map<string, AttendanceEntry>();
  for (const e of entries) {
    entryByDate.set(new Date(e.date).toISOString().slice(0, 10), e);
  }

  const rows: Array<[string, string, string, string]> = [];
  const cursor = new Date(startDate);
  const end = new Date(endDate);
  let sn = 1;
  while (cursor.getTime() <= end.getTime()) {
    const key = cursor.toISOString().slice(0, 10);
    const isFriday = cursor.getUTCDay() === 5;
    const entry = entryByDate.get(key);
    const dateLabel = cursor.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
    const hours = isFriday ? "" : entry ? String(Number(entry.hoursWorked)) : "";
    const remarks = isFriday ? "" : entry ? (DAY_TYPE_REMARKS[entry.dayType] ?? "") : "";
    rows.push([String(sn), dateLabel, hours, remarks]);
    sn += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 16;

  if (branding?.logoDataUrl) {
    try {
      const format = logoFormatFromDataUrl(branding.logoDataUrl);
      doc.addImage(branding.logoDataUrl, format, pageWidth / 2 - 15, y, 30, 16, undefined, "FAST");
      y += 20;
    } catch {
      // fall through without the logo if the data URL can't be decoded (unsupported format)
    }
  }

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(companyName, pageWidth / 2, y, { align: "center" });
  y += 7;
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(title, pageWidth / 2, y, { align: "center" });
  y += 8;

  const infoRows: string[][] = [
    ["Employee Name", employeeName, "Employee Code", employeeCode],
  ];
  if (showDesignation) {
    infoRows.push(["Designation", designation ?? "", "Trade", designation ?? ""]);
  }
  infoRows.push([showIqama ? "Iqama No." : "Month / Year", showIqama ? (iqamaOrNationalId ?? "") : periodLabel, showIqama ? "Month / Year" : "", showIqama ? periodLabel : ""]);

  autoTable(doc, {
    startY: y,
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 2 },
    body: infoRows,
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 35 },
      1: { cellWidth: 55 },
      2: { fontStyle: "bold", cellWidth: 35 },
      3: { cellWidth: 55 },
    },
    margin: { left: 14, right: 14 },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  autoTable(doc, {
    startY: y,
    head: [["S/N", "Date", "Hours", "Remarks"]],
    body: rows,
    foot: [["", "", "Total Monthly Hours:", String(Number(totalHours))]],
    styles: { fontSize: 9, cellPadding: 2, halign: "center" },
    headStyles: { fillColor: accentRgb },
    footStyles: { fillColor: [235, 235, 235], textColor: 0, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 14 },
      1: { cellWidth: 40 },
      2: { cellWidth: 25 },
      3: { halign: "left" },
    },
    margin: { left: 14, right: 14 },
  });

  if (branding?.footerText) {
    const footerY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(branding.footerText, 14, footerY);
  }

  doc.save(`${employeeCode}-${periodLabel.replace(/\s+/g, "-")}-attendance.pdf`);
}
