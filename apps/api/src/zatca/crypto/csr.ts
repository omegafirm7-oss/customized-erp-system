import { randomUUID } from "crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import * as jsrsasign from "jsrsasign";
import { ZatcaEnvironment } from "@prisma/client";

/**
 * ZATCA CSR generation: ECDSA secp256k1 keypair + a PKCS#10 request carrying
 * ZATCA's mandated fields:
 *  - Subject DN: C, OU, O, CN
 *  - Extension OID 1.3.6.1.4.1.311.20.2 (certificateTemplateName):
 *    TSTZATCA-Code-Signing / PREZATCA-Code-Signing / ZATCA-Code-Signing
 *  - subjectAltName dirName: SN (EGS serial "1-x|2-y|3-uuid"), UID (VAT
 *    number), title ("1100" = standard + simplified), registeredAddress,
 *    businessCategory
 */

const TEMPLATE_BY_ENV: Record<ZatcaEnvironment, string> = {
  SANDBOX: "TSTZATCA-Code-Signing",
  SIMULATION: "PREZATCA-Code-Signing",
  PRODUCTION: "ZATCA-Code-Signing",
};

export interface CsrInput {
  environment: ZatcaEnvironment;
  unitName: string;
  organizationName: string;
  organizationUnit: string;
  vatNumber: string;
  registeredAddress: string;
  businessCategory: string;
  /** e.g. "ERP" — combined into the EGS serial number. */
  solutionName: string;
  solutionVersion: string;
}

export interface CsrResult {
  privateKeyPem: string;
  publicKeyPem: string;
  csrPem: string;
  csrBase64: string;
  egsSerialNumber: string;
}

export function generateCsr(input: CsrInput): CsrResult {
  const privateKeyBytes = secp256k1.utils.randomPrivateKey();
  const privateKeyHex = Buffer.from(privateKeyBytes).toString("hex");
  const publicKeyBytes = secp256k1.getPublicKey(privateKeyBytes, false); // uncompressed
  const publicKeyHex = Buffer.from(publicKeyBytes).toString("hex");

  // jsrsasign ECDSA key objects from raw hex
  const ecKey = new jsrsasign.KJUR.crypto.ECDSA({ curve: "secp256k1" });
  ecKey.setPrivateKeyHex(privateKeyHex);
  ecKey.setPublicKeyHex(publicKeyHex);

  const privateKeyPem = jsrsasign.KEYUTIL.getPEM(ecKey, "PKCS8PRV");
  const publicKeyPem = jsrsasign.KEYUTIL.getPEM(ecKey);

  const egsSerialNumber = `1-${input.solutionName}|2-${input.solutionVersion}|3-${randomUUID()}`;

  // The @types/jsrsasign definitions lag the v11 runtime API (which accepts
  // key objects and the generic `extn` ASN.1 parameter form) — hence the casts.
  const csr = new jsrsasign.KJUR.asn1.csr.CertificationRequest({
    subject: {
      str: `/C=SA/OU=${input.organizationUnit}/O=${input.organizationName}/CN=${input.unitName}`,
    },
    sbjpubkey: publicKeyPem,
    extreq: [
      {
        extname: "1.3.6.1.4.1.311.20.2",
        extn: { prnstr: { str: TEMPLATE_BY_ENV[input.environment] } },
      } as never,
      {
        extname: "subjectAltName",
        array: [
          {
            dn: {
              array: [
                [{ type: "SN", value: egsSerialNumber, ds: "prn" }],
                [{ type: "UID", value: input.vatNumber, ds: "prn" }],
                [{ type: "title", value: "1100", ds: "prn" }],
                // jsrsasign has no name mappings for these two — dotted OIDs:
                // registeredAddress = 2.5.4.26, businessCategory = 2.5.4.15
                [{ type: "2.5.4.26", value: input.registeredAddress, ds: "prn" }],
                [{ type: "2.5.4.15", value: input.businessCategory, ds: "prn" }],
              ],
            },
          },
        ],
      },
    ],
    sigalg: "SHA256withECDSA",
    sbjprvkey: privateKeyPem,
  });

  const csrPem = csr.getPEM();
  const csrBase64 = Buffer.from(csrPem, "utf8").toString("base64");

  return { privateKeyPem, publicKeyPem, csrPem, csrBase64, egsSerialNumber };
}

export interface ParsedCertificate {
  /** Base64 certificate body (no PEM armor) */
  base64Body: string;
  serialNumberHex: string;
  issuerString: string;
  notAfter: Date;
  /** DER-encoded SubjectPublicKeyInfo bytes */
  publicKeyDer: Buffer;
  /** The CA's signature bits over this certificate (for QR tag 9) */
  signatureBytes: Buffer;
}

/** Parses a CSID certificate returned by ZATCA (base64, may lack PEM armor). */
export function parseCertificate(base64OrPem: string): ParsedCertificate {
  let base64Body = base64OrPem.trim();
  if (base64Body.includes("BEGIN CERTIFICATE")) {
    base64Body = base64Body
      .replace(/-----BEGIN CERTIFICATE-----/g, "")
      .replace(/-----END CERTIFICATE-----/g, "")
      .replace(/\s+/g, "");
  } else {
    // ZATCA returns the CSID as base64(base64-cert)? No — the
    // binarySecurityToken is base64 of the PEM body. Try decoding once: if
    // the result looks like base64 again, unwrap it.
    const decoded = Buffer.from(base64Body, "base64").toString("utf8");
    if (/^[A-Za-z0-9+/=\r\n]+$/.test(decoded) && decoded.length > 100) {
      base64Body = decoded.replace(/\s+/g, "");
    }
  }

  const pem = `-----BEGIN CERTIFICATE-----\n${base64Body.match(/.{1,64}/g)?.join("\n")}\n-----END CERTIFICATE-----`;
  const cert = new jsrsasign.X509();
  cert.readCertPEM(pem);

  const notAfter = jsrsasign.zulutodate(cert.getNotAfter());
  const publicKeyDer = Buffer.from(jsrsasign.hextob64(cert.getSPKI()), "base64");
  const signatureBytes = Buffer.from(cert.getSignatureValueHex(), "hex");

  return {
    base64Body,
    serialNumberHex: cert.getSerialNumberHex(),
    issuerString: cert.getIssuerString(),
    notAfter,
    publicKeyDer,
    signatureBytes,
  };
}
