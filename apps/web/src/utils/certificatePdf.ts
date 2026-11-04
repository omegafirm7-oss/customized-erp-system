import jsPDF from "jspdf";
import QRCode from "qrcode";
import { apiClient } from "../api/client";
import { downloadsAllowed } from "./downloadGate";
import { logoFormatFromDataUrl } from "./attendancePdf";

interface CertificateDetail {
  id: string;
  certificateNo: string;
  issueDate: string;
  expiryDate: string;
  externalCardNo: string | null;
  verifyToken: string;
  effectiveStatus: "VALID" | "EXPIRED" | "REVOKED";
  course: { code: string; name: string; durationDays: number; durationHours: number | null };
  trainee: {
    id: string;
    fullName: string;
    idType: string;
    idNumber: string;
    nationality: string | null;
    photoMimeType: string | null;
    employerName: string | null;
    employerPartner: { name: string } | null;
  };
  enrollment: { batch: { batchNo: string; startDate: string; endDate: string; venue: string | null; instructorName: string | null } };
  settings: { signatoryName: string | null; signatoryTitle: string | null; certificateFooterText: string | null };
  company: { legalName: string; tradeName: string | null } | null;
}

const ID_LABEL: Record<string, string> = { IQAMA: "Iqama No.", NATIONAL_ID: "National ID", PASSPORT: "Passport No.", OTHER: "ID No." };

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return [16, 24, 40];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function fmt(d: string): string {
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/** Public URL encoded in the certificate QR code. */
export function certificateVerifyUrl(verifyToken: string): string {
  return `${window.location.origin}/verify/${verifyToken}`;
}

/**
 * Landscape A4 training certificate: company logo + accent colour from
 * Template Settings, trainee photo, course/batch details, validity, the
 * external (e.g. TUV) card number when recorded, signatory, and a QR code
 * pointing at the public verification page.
 */
export async function downloadCertificatePdf(certificateId: string): Promise<void> {
  if (!downloadsAllowed()) return;
  const { data: c } = await apiClient.get<CertificateDetail>(`/training/certificates/${certificateId}`);

  let accent = "#101828";
  let logo: string | null = null;
  try {
    const t = await apiClient.get<{ accentColor: string; hasLogo: boolean }>("/settings/templates");
    accent = t.data.accentColor || accent;
    if (t.data.hasLogo) {
      const l = await apiClient.get("/settings/templates/logo", { responseType: "blob" });
      logo = await blobToDataUrl(l.data as Blob);
    }
  } catch {
    // Template settings are optional for the certificate.
  }
  let photo: string | null = null;
  if (c.trainee.photoMimeType) {
    try {
      const p = await apiClient.get(`/training/trainees/${c.trainee.id}/photo`, { responseType: "blob" });
      photo = await blobToDataUrl(p.data as Blob);
    } catch {
      photo = null;
    }
  }
  const qr = await QRCode.toDataURL(certificateVerifyUrl(c.verifyToken), { margin: 1, width: 300 });

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = 297;
  const H = 210;
  const [r, g, b] = hexToRgb(accent);
  const issuer = c.company?.tradeName || c.company?.legalName || "";

  // Double border
  doc.setDrawColor(r, g, b);
  doc.setLineWidth(2.2);
  doc.rect(8, 8, W - 16, H - 16);
  doc.setLineWidth(0.5);
  doc.rect(12, 12, W - 24, H - 24);

  // Header band
  doc.setFillColor(r, g, b);
  doc.rect(12, 12, W - 24, 4, "F");

  if (logo) {
    try {
      const props = doc.getImageProperties(logo);
      const h = 18;
      const w = Math.min((props.width / props.height) * h, 60);
      doc.addImage(logo, logoFormatFromDataUrl(logo), 20, 22, w, h);
    } catch {
      // ignore unreadable logo
    }
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(80, 80, 80);
  doc.text(issuer, W - 20, 28, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Certificate No: ${c.certificateNo}`, W - 20, 34, { align: "right" });
  if (c.externalCardNo) doc.text(`Card No: ${c.externalCardNo}`, W - 20, 39, { align: "right" });

  // Title
  doc.setTextColor(r, g, b);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(30);
  doc.text("CERTIFICATE", W / 2, 58, { align: "center" });
  doc.setFontSize(13);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(90, 90, 90);
  doc.text("OF TRAINING COMPLETION", W / 2, 66, { align: "center" });

  // Photo (left) — the body text stays centred on the page.
  const photoX = 24;
  const photoY = 76;
  if (photo) {
    try {
      doc.addImage(photo, photo.startsWith("data:image/png") ? "PNG" : "JPEG", photoX, photoY, 30, 37);
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.3);
      doc.rect(photoX, photoY, 30, 37);
    } catch {
      // ignore
    }
  }

  doc.setFontSize(11);
  doc.setTextColor(70, 70, 70);
  doc.text("This is to certify that", W / 2, 80, { align: "center" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.setTextColor(20, 20, 20);
  doc.text(c.trainee.fullName, W / 2, 92, { align: "center", maxWidth: 190 });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90, 90, 90);
  const employer = c.trainee.employerPartner?.name ?? c.trainee.employerName;
  const idLine = [
    `${ID_LABEL[c.trainee.idType] ?? "ID No."} ${c.trainee.idNumber}`,
    c.trainee.nationality ? `Nationality: ${c.trainee.nationality}` : null,
    employer ? `Employer: ${employer}` : null,
  ]
    .filter(Boolean)
    .join("   |   ");
  doc.text(idLine, W / 2, 100, { align: "center", maxWidth: 200 });

  doc.setFontSize(11);
  doc.setTextColor(70, 70, 70);
  doc.text("has successfully completed the training course", W / 2, 111, { align: "center" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(r, g, b);
  doc.text(c.course.name, W / 2, 122, { align: "center", maxWidth: 200 });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90, 90, 90);
  const batch = c.enrollment.batch;
  const dur = `${c.course.durationDays} day${c.course.durationDays === 1 ? "" : "s"}${c.course.durationHours ? ` (${c.course.durationHours} hours)` : ""}`;
  doc.text(`held from ${fmt(batch.startDate)} to ${fmt(batch.endDate)}  ·  Duration: ${dur}${batch.venue ? `  ·  Venue: ${batch.venue}` : ""}`, W / 2, 130, {
    align: "center",
    maxWidth: 220,
  });

  // Validity boxes
  const boxY = 140;
  const boxes = [
    { label: "ISSUE DATE", value: fmt(c.issueDate) },
    { label: "VALID UNTIL", value: fmt(c.expiryDate) },
    { label: "BATCH", value: batch.batchNo },
  ];
  const bw = 46;
  const startX = W / 2 - (bw * boxes.length + 6 * (boxes.length - 1)) / 2;
  boxes.forEach((bx, i) => {
    const x = startX + i * (bw + 6);
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(0.4);
    doc.roundedRect(x, boxY, bw, 15, 2, 2);
    doc.setFontSize(7.5);
    doc.setTextColor(120, 120, 120);
    doc.text(bx.label, x + bw / 2, boxY + 5.5, { align: "center" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(20, 20, 20);
    doc.text(bx.value, x + bw / 2, boxY + 11.5, { align: "center" });
    doc.setFont("helvetica", "normal");
  });

  // Signatures
  const sigY = 178;
  doc.setDrawColor(150, 150, 150);
  doc.setLineWidth(0.3);
  doc.line(40, sigY, 110, sigY);
  doc.setFontSize(9.5);
  doc.setTextColor(40, 40, 40);
  doc.text(c.settings.signatoryName ?? "Authorized Signatory", 75, sigY + 5, { align: "center" });
  doc.setFontSize(8);
  doc.setTextColor(110, 110, 110);
  doc.text(c.settings.signatoryTitle ?? issuer, 75, sigY + 9.5, { align: "center" });
  if (batch.instructorName) {
    doc.line(125, sigY, 185, sigY);
    doc.setFontSize(9.5);
    doc.setTextColor(40, 40, 40);
    doc.text(batch.instructorName, 155, sigY + 5, { align: "center" });
    doc.setFontSize(8);
    doc.setTextColor(110, 110, 110);
    doc.text("Instructor", 155, sigY + 9.5, { align: "center" });
  }

  // QR
  doc.addImage(qr, "PNG", W - 58, 156, 32, 32);
  doc.setFontSize(7);
  doc.setTextColor(110, 110, 110);
  doc.text("Scan to verify", W - 42, 191, { align: "center" });

  if (c.settings.certificateFooterText) {
    doc.setFontSize(7.5);
    doc.setTextColor(120, 120, 120);
    doc.text(c.settings.certificateFooterText, W / 2, H - 15, { align: "center", maxWidth: 200 });
  }

  if (c.effectiveStatus === "REVOKED") {
    doc.setTextColor(220, 40, 40);
    doc.setFontSize(60);
    doc.text("REVOKED", W / 2, H / 2 + 10, { align: "center", angle: 20 });
  }

  doc.save(`${c.certificateNo} - ${c.trainee.fullName}.pdf`);
}
