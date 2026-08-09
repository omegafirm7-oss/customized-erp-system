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
  headerTagline?: string | null;
  headerMissionLine?: string | null;
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

export interface AttendancePdfParams {
  companyName: string;
  employeeName: string;
  employeeCode: string;
  designation?: string;
  iqamaOrNationalId?: string;
  projectName?: string;
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
}

/**
 * Builds one employee's day-by-day attendance for a single period into a
 * letterhead-styled PDF matching the client's official monthly timesheet
 * template (S/N, Date, Hours, Remarks — Friday always 0 hrs/"Friday off",
 * 0 hrs "Absent", 5 hrs "Half working day", 10 hrs "Full working day";
 * total at the bottom).
 * One row per calendar day in [startDate, endDate], not just days that have
 * a recorded entry — matches the printed sheet's fixed 1..31 row layout.
 * Returns the jsPDF instance so callers can `.save()` it or pull a `.output()`
 * blob for other destinations (e.g. WhatsApp share) without generating twice.
 */
export function buildEmployeeAttendancePdf(params: AttendancePdfParams): jsPDF {
  const { companyName, employeeName, designation, iqamaOrNationalId, projectName, periodLabel, startDate, endDate, entries, totalHours, branding } = params;
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
    const hoursNum = isFriday ? 0 : entry ? Number(entry.hoursWorked) : 0;
    const remarks = isFriday
      ? "Friday off"
      : hoursNum === 0
        ? "Absent"
        : hoursNum === 5
          ? "Half working day"
          : hoursNum === 10
            ? "Full working day"
            : entry
              ? (DAY_TYPE_REMARKS[entry.dayType] ?? "")
              : "";
    rows.push([String(sn), dateLabel, String(hoursNum), remarks]);
    sn += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 14;

  // White header: logo + three stacked lines in the same font (company name,
  // industry tagline, mission line), then the document title centered below.
  let textX = marginX;
  if (branding?.logoDataUrl) {
    try {
      const format = logoFormatFromDataUrl(branding.logoDataUrl);
      doc.addImage(branding.logoDataUrl, format, marginX, 4, 16, 16, undefined, "FAST");
      textX = marginX + 20;
    } catch {
      // fall through without the logo if the data URL can't be decoded (unsupported format)
    }
  }

  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...accentRgb);
  doc.text(companyName.toUpperCase(), textX, 11);

  let headerLineY = 17;
  if (branding?.headerTagline) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(200, 40, 40);
    doc.text(branding.headerTagline.toUpperCase(), textX, headerLineY);
    headerLineY += 5.5;
  }
  if (branding?.headerMissionLine) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(200, 40, 40);
    doc.text(branding.headerMissionLine, textX, headerLineY);
    headerLineY += 5.5;
  }
  doc.setTextColor(0, 0, 0);

  let y = Math.max(26, headerLineY + 4);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text(title, pageWidth / 2, y, { align: "center" });
  y += 6;
  doc.setDrawColor(...accentRgb);
  doc.setLineWidth(0.8);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 8;

  // Fixed 5-row x 2-column layout mirroring the client's printed form —
  // Location/Zone/Supervisor have no data source in this app and print
  // blank (matching a physical form's fill-by-hand fields). Project comes
  // from the employee's assigned cost center, when that cost center is a
  // project's dedicated one (Employee.costCenterId -> CostCenter.project).
  const infoRows: string[][] = [
    ["Project", projectName ?? "", "Employee Name", employeeName],
    ["Location", "", "Designation", showDesignation ? (designation ?? "") : ""],
    ["Zone", "", "Trade", showDesignation ? (designation ?? "") : ""],
    ["Month / Year", periodLabel, "Iqama No.", showIqama ? (iqamaOrNationalId ?? "") : ""],
    ["Supervisor", "", "Signature", ""],
  ];

  autoTable(doc, {
    startY: y,
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 3, fontStyle: "bold" },
    body: infoRows,
    columnStyles: {
      0: { cellWidth: 35, fillColor: [240, 240, 244] },
      1: { cellWidth: 55 },
      2: { cellWidth: 35, fillColor: [240, 240, 244] },
      3: { cellWidth: 55 },
    },
    margin: { left: marginX, right: marginX },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  autoTable(doc, {
    startY: y,
    head: [["S/N", "Date", "Hours", "Remarks"]],
    body: rows,
    foot: [["", "", "Total Monthly Hours:", String(Number(totalHours))]],
    // Without this, autoTable repeats the foot row at the bottom of every
    // page a multi-page body spans — the total should print once, at the end.
    showFoot: "lastPage",
    styles: { fontSize: 9, cellPadding: 2, halign: "center", fontStyle: "bold", lineWidth: 0.3 },
    headStyles: { fillColor: accentRgb, fontStyle: "bold" },
    footStyles: { fillColor: [235, 235, 235], textColor: 0, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 14 },
      1: { cellWidth: 40 },
      2: { cellWidth: 25 },
      3: { halign: "left" },
    },
    margin: { left: marginX, right: marginX },
  });

  if (branding?.footerText) {
    const footerY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(branding.footerText, 14, footerY);
  }

  return doc;
}

export function attendancePdfFilename(employeeCode: string, periodLabel: string): string {
  return `${employeeCode}-${periodLabel.replace(/\s+/g, "-")}-attendance.pdf`;
}

/** Convenience wrapper — builds the PDF and triggers a browser download immediately. */
export function downloadEmployeeAttendancePdf(params: AttendancePdfParams) {
  const doc = buildEmployeeAttendancePdf(params);
  doc.save(attendancePdfFilename(params.employeeCode, params.periodLabel));
}
