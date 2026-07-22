import { createHash } from "crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import * as jsrsasign from "jsrsasign";
import { ZatcaEnvironment } from "@prisma/client";
import { generateCsr } from "./csr";
import { signInvoice, embedQrInXml } from "./xades";
import { computeInvoiceHash, computeInvoiceDigestBytes } from "./invoice-hash";
import { buildQrPayload, decodeTlv } from "./tlv";

/**
 * Self-signed certificate helper standing in for a ZATCA CSID during unit
 * tests — same curve, same fields we rely on (issuer, serial, public key).
 */
function makeSelfSignedCert(privateKeyPem: string, publicKeyPem: string): string {
  const cert = new jsrsasign.KJUR.asn1.x509.Certificate({
    version: 3,
    serial: { int: 1234567 },
    issuer: { str: "/C=SA/O=ZATCA-Test-CA/CN=TestCA" },
    notbefore: "260101000000Z",
    notafter: "280101000000Z",
    subject: { str: "/C=SA/O=Demo Company/CN=ERP-Unit-1" },
    sbjpubkey: publicKeyPem,
    ext: [],
    sigalg: "SHA256withECDSA",
    cakey: privateKeyPem,
  });
  return cert.getPEM();
}

const SAMPLE_UNSIGNED_XML = `<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"><cbc:ProfileID>reporting:1.0</cbc:ProfileID><cbc:ID>INV-000001</cbc:ID><cbc:UUID>8e6dded5-2109-4b2b-9bcd-4cba1f1e0a10</cbc:UUID><cbc:IssueDate>2026-07-14</cbc:IssueDate><cbc:IssueTime>10:30:00</cbc:IssueTime><cbc:InvoiceTypeCode name="0200000">388</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode><cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode><cac:AdditionalDocumentReference><cbc:ID>ICV</cbc:ID><cbc:UUID>1</cbc:UUID></cac:AdditionalDocumentReference><cac:AccountingSupplierParty><cac:Party><cac:PartyLegalEntity><cbc:RegistrationName>Demo Company Ltd</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty></Invoice>`;

describe("xades", () => {
  const csr = generateCsr({
    environment: ZatcaEnvironment.SANDBOX,
    unitName: "ERP-Unit-1",
    organizationName: "Demo Company Ltd",
    organizationUnit: "HQ",
    vatNumber: "310000000000003",
    registeredAddress: "Riyadh",
    businessCategory: "Technology",
    solutionName: "ERP",
    solutionVersion: "1.0",
  });
  const certPem = makeSelfSignedCert(csr.privateKeyPem, csr.publicKeyPem);
  const certBase64 = Buffer.from(certPem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, ""), "base64").length
    ? certPem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "")
    : "";

  it("signs an invoice: hash preserved, signature verifies against the cert key", () => {
    const result = signInvoice({
      unsignedXml: SAMPLE_UNSIGNED_XML,
      certificateBase64: certBase64,
      privateKeyPem: csr.privateKeyPem,
      signingTime: "2026-07-14T10:30:00Z",
    });

    // Invoice hash of the SIGNED xml must equal the unsigned hash (the
    // hasher strips the UBLExtensions + Signature we spliced in)
    expect(computeInvoiceHash(result.signedXml)).toBe(result.invoiceHash);
    expect(result.invoiceHash).toBe(computeInvoiceHash(SAMPLE_UNSIGNED_XML));

    // Structure: UBLExtensions right after the Invoice open tag, Signature
    // block before AccountingSupplierParty, cert embedded
    expect(result.signedXml.indexOf("<ext:UBLExtensions>")).toBeLessThan(result.signedXml.indexOf("<cbc:ProfileID>"));
    expect(result.signedXml).toContain("urn:oasis:names:specification:ubl:signature:Invoice");
    expect(result.signedXml).toContain(certBase64);

    // ECDSA signature over the invoice digest bytes verifies with the cert's public key
    const digest = computeInvoiceDigestBytes(SAMPLE_UNSIGNED_XML);
    const signatureDer = Buffer.from(result.signatureBase64, "base64");
    const publicKeyHex = Buffer.from(result.parsedCertificate.publicKeyDer).toString("hex");
    // Extract the uncompressed EC point (last 65 bytes of the SPKI DER)
    const point = Buffer.from(publicKeyHex.slice(-130), "hex");
    const sig = secp256k1.Signature.fromDER(signatureDer);
    expect(secp256k1.verify(sig.toCompactRawBytes(), digest, point)).toBe(true);
  });

  it("computes ZATCA-quirk digests: base64(hex(sha256)) for cert digest", () => {
    const result = signInvoice({
      unsignedXml: SAMPLE_UNSIGNED_XML,
      certificateBase64: certBase64,
      privateKeyPem: csr.privateKeyPem,
      signingTime: "2026-07-14T10:30:00Z",
    });
    const expectedCertDigest = Buffer.from(
      createHash("sha256").update(certBase64, "utf8").digest("hex"),
      "utf8",
    ).toString("base64");
    expect(result.signedXml).toContain(expectedCertDigest);
    // Decoding the digest yields a 64-char lowercase hex string
    const decoded = Buffer.from(expectedCertDigest, "base64").toString("utf8");
    expect(decoded).toMatch(/^[0-9a-f]{64}$/);
  });

  it("embeds a QR reference without changing the invoice hash", () => {
    const result = signInvoice({
      unsignedXml: SAMPLE_UNSIGNED_XML,
      certificateBase64: certBase64,
      privateKeyPem: csr.privateKeyPem,
    });

    const qr = buildQrPayload({
      sellerName: "Demo Company Ltd",
      sellerVatNumber: "310000000000003",
      timestamp: "2026-07-14T10:30:00Z",
      invoiceTotal: "1150.00",
      vatTotal: "150.00",
      invoiceHash: result.invoiceHash,
      signature: Buffer.from(result.signatureBase64, "base64"),
      publicKey: result.parsedCertificate.publicKeyDer,
      certificateSignature: result.parsedCertificate.signatureBytes,
    });

    const withQr = embedQrInXml(result.signedXml, qr);
    expect(withQr).toContain(`<cbc:ID>QR</cbc:ID>`);
    expect(computeInvoiceHash(withQr)).toBe(result.invoiceHash);

    // QR payload round-trips and carries 9 tags for simplified invoices
    const fields = decodeTlv(Buffer.from(qr, "base64"));
    expect(fields.map((f) => f.tag)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(fields[5].value.toString("utf8")).toBe(result.invoiceHash);
  });
});
