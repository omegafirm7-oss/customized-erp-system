import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import "./training.css";

interface VerifyResult {
  status: "VALID" | "EXPIRED" | "REVOKED";
  certificateNo: string;
  externalCardNo: string | null;
  issueDate: string;
  expiryDate: string;
  revokedReason: string | null;
  course: string;
  courseCode: string;
  traineeName: string;
  traineeNameAr: string | null;
  nationality: string | null;
  idNumberMasked: string;
  idType: string;
  employer: string | null;
  issuer: string;
  hasPhoto: boolean;
}

const ID_LABEL: Record<string, string> = { IQAMA: "Iqama", NATIONAL_ID: "National ID", PASSPORT: "Passport", OTHER: "ID" };

function fmt(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });
}

/** Public page opened from the QR code on a training certificate. No login. */
export function CertificateVerifyPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<VerifyResult | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "notfound" | "error">("loading");

  useEffect(() => {
    // Plain axios (not apiClient): no auth, no refresh-token retry.
    axios
      .get<VerifyResult>(`/api/public/training/verify/${token}`)
      .then((r) => {
        setData(r.data);
        setState("ok");
      })
      .catch((e) => setState(e?.response?.status === 404 || e?.response?.status === 400 ? "notfound" : "error"));
  }, [token]);

  const banner =
    state === "ok" && data
      ? data.status === "VALID"
        ? { cls: "valid", icon: "✔", title: "Valid certificate" }
        : data.status === "EXPIRED"
          ? { cls: "expired", icon: "!", title: "Certificate expired" }
          : { cls: "revoked", icon: "✕", title: "Certificate revoked" }
      : state === "notfound"
        ? { cls: "notfound", icon: "✕", title: "Certificate not found" }
        : null;

  return (
    <div className="trn-verify-page">
      <div className="trn-verify-card">
        {state === "loading" && <div className="trn-verify-body">Checking certificate…</div>}
        {state === "error" && <div className="trn-verify-body">Couldn't check this certificate right now. Please try again.</div>}
        {banner && (
          <div className={`trn-verify-banner ${banner.cls}`}>
            <div className="trn-verify-icon">{banner.icon}</div>
            <h1>{banner.title}</h1>
          </div>
        )}
        {state === "notfound" && (
          <div className="trn-verify-body">This QR code or link doesn't match any certificate. It may be mistyped or not genuine.</div>
        )}
        {state === "ok" && data && (
          <div className="trn-verify-body">
            <div className="trn-verify-person">
              {data.hasPhoto && <img className="trn-photo" src={`/api/public/training/verify/${token}/photo`} alt="" />}
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{data.traineeName}</div>
                {data.traineeNameAr && <div dir="rtl">{data.traineeNameAr}</div>}
                <div className="trn-muted">
                  {ID_LABEL[data.idType] ?? "ID"} {data.idNumberMasked}
                </div>
              </div>
            </div>
            <div className="trn-verify-rows">
              <div>
                <span>Course</span>
                <span>{data.course}</span>
              </div>
              <div>
                <span>Certificate no.</span>
                <span>{data.certificateNo}</span>
              </div>
              {data.externalCardNo && (
                <div>
                  <span>Card no.</span>
                  <span>{data.externalCardNo}</span>
                </div>
              )}
              <div>
                <span>Issued</span>
                <span>{fmt(data.issueDate)}</span>
              </div>
              <div>
                <span>Valid until</span>
                <span>{fmt(data.expiryDate)}</span>
              </div>
              {data.employer && (
                <div>
                  <span>Employer</span>
                  <span>{data.employer}</span>
                </div>
              )}
              {data.nationality && (
                <div>
                  <span>Nationality</span>
                  <span>{data.nationality}</span>
                </div>
              )}
              <div>
                <span>Issued by</span>
                <span>{data.issuer}</span>
              </div>
              {data.revokedReason && (
                <div>
                  <span>Reason</span>
                  <span>{data.revokedReason}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
