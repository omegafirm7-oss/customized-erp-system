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
}) {
  const { companyName, employeeName, employeeCode, designation, iqamaOrNationalId, periodLabel, startDate, endDate, entries, totalHours } = params;

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

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(companyName, pageWidth / 2, y, { align: "center" });
  y += 7;
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text("Monthly Timesheet", pageWidth / 2, y, { align: "center" });
  y += 8;

  autoTable(doc, {
    startY: y,
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 2 },
    body: [
      ["Employee Name", employeeName, "Employee Code", employeeCode],
      ["Designation", designation ?? "", "Trade", designation ?? ""],
      ["Iqama No.", iqamaOrNationalId ?? "", "Month / Year", periodLabel],
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

  autoTable(doc, {
    startY: y,
    head: [["S/N", "Date", "Hours", "Remarks"]],
    body: rows,
    foot: [["", "", "Total Monthly Hours:", String(Number(totalHours))]],
    styles: { fontSize: 9, cellPadding: 2, halign: "center" },
    headStyles: { fillColor: [16, 24, 40] },
    footStyles: { fillColor: [235, 235, 235], textColor: 0, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 14 },
      1: { cellWidth: 40 },
      2: { cellWidth: 25 },
      3: { halign: "left" },
    },
    margin: { left: 14, right: 14 },
  });

  doc.save(`${employeeCode}-${periodLabel.replace(/\s+/g, "-")}-attendance.pdf`);
}
