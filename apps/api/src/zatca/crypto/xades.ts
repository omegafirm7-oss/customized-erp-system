import { createHash } from "crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import * as jsrsasign from "jsrsasign";
import { computeInvoiceDigestBytes, computeInvoiceHash } from "./invoice-hash";
import { parseCertificate, ParsedCertificate } from "./csr";

/**
 * ZATCA XAdES B-B enveloped signature. Deliberately NOT a generic XML-DSig
 * implementation — ZATCA's validator expects the exact structure its own SDK
 * produces, including two non-standard behaviors:
 *
 *  1. SignatureValue = ECDSA over the *invoice hash digest bytes* (the same
 *     digest exposed in the first Reference), not over canonicalized
 *     SignedInfo as vanilla XML-DSig would require.
 *  2. The SignedProperties Reference DigestValue and the xades CertDigest are
 *     base64 encodings of the LOWERCASE HEX STRING of the SHA-256 (i.e.
 *     base64(hex(sha256(x)))), not base64 of the raw digest bytes.
 *
 * The SignedProperties serialization the digest is computed over is
 * whitespace-sensitive; the template below reproduces the ZATCA SDK layout.
 */

export interface SignInvoiceInput {
  unsignedXml: string;
  certificateBase64: string;
  privateKeyPem: string;
  signingTime?: string; // ISO, defaults to now (UTC, seconds precision)
}

export interface SignInvoiceResult {
  signedXml: string;
  invoiceHash: string;
  signatureBase64: string;
  parsedCertificate: ParsedCertificate;
  signingTime: string;
}

function sha256HexB64(input: string): string {
  return Buffer.from(createHash("sha256").update(input, "utf8").digest("hex"), "utf8").toString("base64");
}

function getPrivateKeyHex(privateKeyPem: string): string {
  const key = jsrsasign.KEYUTIL.getKey(privateKeyPem) as jsrsasign.KJUR.crypto.ECDSA;
  return (key as unknown as { prvKeyHex: string }).prvKeyHex;
}

/** The whitespace-sensitive SignedProperties block whose digest goes into the
 * second Reference. Indentation mirrors the ZATCA SDK output exactly. */
function buildSignedPropertiesForHashing(signingTime: string, certDigestB64: string, issuerName: string, serialDecimal: string): string {
  return (
    `<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="xadesSignedProperties">
                                    <xades:SignedSignatureProperties>
                                        <xades:SigningTime>${signingTime}</xades:SigningTime>
                                        <xades:SigningCertificate>
                                            <xades:Cert>
                                                <xades:CertDigest>
                                                    <ds:DigestMethod xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
                                                    <ds:DigestValue xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${certDigestB64}</ds:DigestValue>
                                                </xades:CertDigest>
                                                <xades:IssuerSerial>
                                                    <ds:X509IssuerName xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${issuerName}</ds:X509IssuerName>
                                                    <ds:X509SerialNumber xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${serialDecimal}</ds:X509SerialNumber>
                                                </xades:IssuerSerial>
                                            </xades:Cert>
                                        </xades:SigningCertificate>
                                    </xades:SignedSignatureProperties>
                                </xades:SignedProperties>`
  );
}

export function signInvoice(input: SignInvoiceInput): SignInvoiceResult {
  const cert = parseCertificate(input.certificateBase64);

  const invoiceHash = computeInvoiceHash(input.unsignedXml);
  const digestBytes = computeInvoiceDigestBytes(input.unsignedXml);

  const privateKeyHex = getPrivateKeyHex(input.privateKeyPem);
  const signature = secp256k1.sign(digestBytes, privateKeyHex);
  const signatureBase64 = Buffer.from(signature.toDERRawBytes()).toString("base64");

  const signingTime = input.signingTime ?? new Date().toISOString().split(".")[0] + "Z";
  const certDigestB64 = sha256HexB64(cert.base64Body);
  const issuerName = formatIssuerName(cert.issuerString);
  const serialDecimal = BigInt("0x" + cert.serialNumberHex).toString(10);

  const signedProperties = buildSignedPropertiesForHashing(signingTime, certDigestB64, issuerName, serialDecimal);
  const signedPropertiesDigestB64 = sha256HexB64(signedProperties);

  const ublExtensions = buildUblExtensionsBlock({
    invoiceHash,
    signatureBase64,
    certificateBase64: cert.base64Body,
    signingTime,
    certDigestB64,
    issuerName,
    serialDecimal,
    signedPropertiesDigestB64,
  });

  // Splice: UBLExtensions immediately after the <Invoice ...> open tag;
  // cac:Signature immediately before cac:AccountingSupplierParty.
  let signedXml = input.unsignedXml;
  const invoiceOpenEnd = signedXml.indexOf(">", signedXml.indexOf("<Invoice")) + 1;
  signedXml = signedXml.slice(0, invoiceOpenEnd) + ublExtensions + signedXml.slice(invoiceOpenEnd);

  const signatureBlock =
    `<cac:Signature><cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID><cbc:SignatureMethod>urn:oasis:names:specification:ubl:dsig:enveloped:xades</cbc:SignatureMethod></cac:Signature>`;
  signedXml = signedXml.replace("<cac:AccountingSupplierParty>", signatureBlock + "<cac:AccountingSupplierParty>");

  return { signedXml, invoiceHash, signatureBase64, parsedCertificate: cert, signingTime };
}

/** Adds the QR AdditionalDocumentReference after the PIH reference. Called
 * after signing (the QR content includes the signature) — the QR docref is
 * excluded from hashing, so this does not invalidate the invoice hash. */
export function embedQrInXml(signedXml: string, qrBase64: string): string {
  const qrRef =
    `<cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${qrBase64}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>`;
  // Insert after the PIH document reference (the last AdditionalDocumentReference before the supplier party)
  const supplierIdx = signedXml.indexOf("<cac:Signature>");
  const insertIdx = supplierIdx === -1 ? signedXml.indexOf("<cac:AccountingSupplierParty>") : supplierIdx;
  return signedXml.slice(0, insertIdx) + qrRef + signedXml.slice(insertIdx);
}

function formatIssuerName(jsrsasignIssuer: string): string {
  // jsrsasign returns "/C=SA/O=.../CN=..."; XAdES wants "CN=..., O=..., C=SA"
  const parts = jsrsasignIssuer.split("/").filter(Boolean);
  return parts.reverse().join(", ");
}

interface UblExtensionsInput {
  invoiceHash: string;
  signatureBase64: string;
  certificateBase64: string;
  signingTime: string;
  certDigestB64: string;
  issuerName: string;
  serialDecimal: string;
  signedPropertiesDigestB64: string;
}

function buildUblExtensionsBlock(input: UblExtensionsInput): string {
  return (
    `<ext:UBLExtensions>
        <ext:UBLExtension>
            <ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI>
            <ext:ExtensionContent>
                <sig:UBLDocumentSignatures xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2" xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2">
                    <sac:SignatureInformation>
                        <cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID>
                        <sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID>
                        <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="signature">
                            <ds:SignedInfo>
                                <ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"/>
                                <ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/>
                                <ds:Reference Id="invoiceSignedData" URI="">
                                    <ds:Transforms>
                                        <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
                                            <ds:XPath>not(//ancestor-or-self::ext:UBLExtensions)</ds:XPath>
                                        </ds:Transform>
                                        <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
                                            <ds:XPath>not(//ancestor-or-self::cac:Signature)</ds:XPath>
                                        </ds:Transform>
                                        <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
                                            <ds:XPath>not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])</ds:XPath>
                                        </ds:Transform>
                                        <ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"/>
                                    </ds:Transforms>
                                    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
                                    <ds:DigestValue>${input.invoiceHash}</ds:DigestValue>
                                </ds:Reference>
                                <ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties">
                                    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
                                    <ds:DigestValue>${input.signedPropertiesDigestB64}</ds:DigestValue>
                                </ds:Reference>
                            </ds:SignedInfo>
                            <ds:SignatureValue>${input.signatureBase64}</ds:SignatureValue>
                            <ds:KeyInfo>
                                <ds:X509Data>
                                    <ds:X509Certificate>${input.certificateBase64}</ds:X509Certificate>
                                </ds:X509Data>
                            </ds:KeyInfo>
                            <ds:Object>
                                <xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Target="signature">
                                    <xades:SignedProperties Id="xadesSignedProperties">
                                    <xades:SignedSignatureProperties>
                                        <xades:SigningTime>${input.signingTime}</xades:SigningTime>
                                        <xades:SigningCertificate>
                                            <xades:Cert>
                                                <xades:CertDigest>
                                                    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
                                                    <ds:DigestValue>${input.certDigestB64}</ds:DigestValue>
                                                </xades:CertDigest>
                                                <xades:IssuerSerial>
                                                    <ds:X509IssuerName>${input.issuerName}</ds:X509IssuerName>
                                                    <ds:X509SerialNumber>${input.serialDecimal}</ds:X509SerialNumber>
                                                </xades:IssuerSerial>
                                            </xades:Cert>
                                        </xades:SigningCertificate>
                                    </xades:SignedSignatureProperties>
                                </xades:SignedProperties>
                                </xades:QualifyingProperties>
                            </ds:Object>
                        </ds:Signature>
                    </sac:SignatureInformation>
                </sig:UBLDocumentSignatures>
            </ext:ExtensionContent>
        </ext:UBLExtension>
    </ext:UBLExtensions>`
  );
}
