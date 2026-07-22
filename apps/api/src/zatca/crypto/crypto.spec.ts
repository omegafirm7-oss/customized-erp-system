import { createHash, randomBytes } from "crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import { ZatcaEnvironment } from "@prisma/client";
import * as jsrsasign from "jsrsasign";
import { encryptSecret, decryptSecret } from "./key-encryption";
import { encodeTlv, decodeTlv, buildQrPayload } from "./tlv";
import { canonicalizeXml } from "./c14n11";
import { computeInvoiceHash, stripForHashing, PIH_SEED } from "./invoice-hash";
import { generateCsr } from "./csr";

describe("key-encryption", () => {
  const key = randomBytes(32).toString("base64");

  it("round-trips a private key PEM", () => {
    const secret = "-----BEGIN PRIVATE KEY-----\nMIGH...\n-----END PRIVATE KEY-----";
    const encrypted = encryptSecret(secret, key);
    expect(encrypted).not.toContain("PRIVATE KEY");
    expect(decryptSecret(encrypted, key)).toBe(secret);
  });

  it("detects tampering via the GCM auth tag", () => {
    const encrypted = encryptSecret("secret-value", key);
    const [iv, tag, data] = encrypted.split(":");
    const tampered = Buffer.from(data, "base64");
    tampered[0] ^= 0xff;
    expect(() => decryptSecret(`${iv}:${tag}:${tampered.toString("base64")}`, key)).toThrow();
  });

  it("rejects keys of the wrong length", () => {
    expect(() => encryptSecret("x", Buffer.from("short").toString("base64"))).toThrow();
  });
});

describe("tlv", () => {
  it("encodes and decodes round-trip including binary values", () => {
    const fields = [
      { tag: 1, value: Buffer.from("شركة التجارة", "utf8") }, // Arabic seller name
      { tag: 2, value: Buffer.from("310000000000003", "utf8") },
      { tag: 7, value: randomBytes(71) }, // DER ECDSA signature-ish
    ];
    const decoded = decodeTlv(encodeTlv(fields));
    expect(decoded).toHaveLength(3);
    expect(decoded[0].value.toString("utf8")).toBe("شركة التجارة");
    expect(decoded[1].value.toString("utf8")).toBe("310000000000003");
    expect(decoded[2].value.equals(fields[2].value)).toBe(true);
  });

  it("builds a QR payload whose TLV fields decode to the inputs", () => {
    const payload = buildQrPayload({
      sellerName: "Demo Company Ltd",
      sellerVatNumber: "310000000000003",
      timestamp: "2026-07-14T10:30:00Z",
      invoiceTotal: "1150.00",
      vatTotal: "150.00",
      invoiceHash: "abc123hash",
      signature: Buffer.from("sig"),
      publicKey: Buffer.from("pub"),
      certificateSignature: Buffer.from("certsig"),
    });
    const fields = decodeTlv(Buffer.from(payload, "base64"));
    expect(fields.map((f) => f.tag)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(fields[3].value.toString("utf8")).toBe("1150.00");
    expect(fields[8].value.toString("utf8")).toBe("certsig");
  });

  it("rejects oversized values", () => {
    expect(() => encodeTlv([{ tag: 1, value: randomBytes(256) }])).toThrow();
  });
});

describe("c14n11", () => {
  it("sorts attributes and expands empty elements", () => {
    const xml = `<root b="2" a="1"><empty/></root>`;
    expect(canonicalizeXml(xml)).toBe(`<root a="1" b="2"><empty></empty></root>`);
  });

  it("strips comments and keeps CDATA as escaped text", () => {
    const xml = `<root><!-- comment --><a><![CDATA[x < y & z]]></a></root>`;
    expect(canonicalizeXml(xml)).toBe(`<root><a>x &lt; y &amp; z</a></root>`);
  });

  it("removes superfluous namespace re-declarations", () => {
    const xml = `<a xmlns:n="urn:x"><b xmlns:n="urn:x"><n:c/></b></a>`;
    expect(canonicalizeXml(xml)).toBe(`<a xmlns:n="urn:x"><b><n:c></n:c></b></a>`);
  });

  it("escapes attribute whitespace as character references", () => {
    // A literal newline would be normalized to a space by the XML parser
    // (per XML 1.0 attribute-value normalization); only a character
    // reference survives into the parsed value.
    const xml = `<a x="line1&#xA;line2"/>`;
    expect(canonicalizeXml(xml)).toBe(`<a x="line1&#xA;line2"></a>`);
  });

  it("preserves UTF-8 text (Arabic)", () => {
    const xml = `<a>فاتورة ضريبية</a>`;
    expect(canonicalizeXml(xml)).toBe(`<a>فاتورة ضريبية</a>`);
  });
});

describe("invoice-hash", () => {
  const invoiceXml = `<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"><ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent>SIGNATURE</ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions><cbc:ID>INV-1</cbc:ID><cac:AdditionalDocumentReference><cbc:ID>ICV</cbc:ID></cac:AdditionalDocumentReference><cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject>QRDATA</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference><cac:Signature><cbc:ID>sig</cbc:ID></cac:Signature></Invoice>`;

  it("strips UBLExtensions, Signature, and the QR docref but keeps ICV", () => {
    const stripped = stripForHashing(invoiceXml);
    expect(stripped).not.toContain("UBLExtensions");
    expect(stripped).not.toContain("QRDATA");
    expect(stripped).not.toContain("cac:Signature");
    expect(stripped).toContain("ICV");
    expect(stripped).toContain("INV-1");
  });

  it("produces a stable base64 SHA-256 and changes when content changes", () => {
    const hash1 = computeInvoiceHash(invoiceXml);
    const hash2 = computeInvoiceHash(invoiceXml);
    expect(hash1).toBe(hash2);
    expect(Buffer.from(hash1, "base64")).toHaveLength(32);

    const changed = invoiceXml.replace("INV-1", "INV-2");
    expect(computeInvoiceHash(changed)).not.toBe(hash1);
  });

  it("hash is independent of the signature/QR content", () => {
    const withDifferentSig = invoiceXml.replace("SIGNATURE", "OTHER").replace("QRDATA", "OTHERQR");
    expect(computeInvoiceHash(withDifferentSig)).toBe(computeInvoiceHash(invoiceXml));
  });

  it("PIH seed matches the ZATCA specification value", () => {
    const expected = Buffer.from(createHash("sha256").update("0").digest("hex"), "utf8").toString("base64");
    expect(PIH_SEED).toBe(expected);
  });
});

describe("csr", () => {
  const input = {
    environment: ZatcaEnvironment.SANDBOX,
    unitName: "ERP-Unit-1",
    organizationName: "Demo Company Ltd",
    organizationUnit: "Riyadh Branch",
    vatNumber: "310000000000003",
    registeredAddress: "Riyadh",
    businessCategory: "Technology",
    solutionName: "ERP",
    solutionVersion: "1.0",
  };

  it("generates a secp256k1 CSR with ZATCA subject and extensions", () => {
    const result = generateCsr(input);

    expect(result.privateKeyPem).toContain("PRIVATE KEY");
    expect(result.csrPem).toContain("CERTIFICATE REQUEST");
    expect(result.egsSerialNumber).toMatch(/^1-ERP\|2-1\.0\|3-[0-9a-f-]{36}$/);

    const csr = jsrsasign.KJUR.asn1.csr.CSRUtil.getParam(result.csrPem);
    expect(csr.subject?.str).toContain("CN=ERP-Unit-1");
    expect(csr.subject?.str).toContain("O=Demo Company Ltd");
    expect(csr.subject?.str).toContain("C=SA");

    const extensions = (csr.extreq ?? []) as Array<Record<string, any>>;
    const template = extensions.find((e) => e.extname === "1.3.6.1.4.1.311.20.2");
    expect(template).toBeDefined();
    expect(JSON.stringify(template)).toContain("TSTZATCA-Code-Signing");

    const san = extensions.find((e) => e.extname === "subjectAltName");
    const sanStr = JSON.stringify(san);
    expect(sanStr).toContain(result.egsSerialNumber.replace(/\|/g, "\\u007f") !== sanStr ? result.egsSerialNumber : "");
    expect(sanStr).toContain("310000000000003");
    expect(sanStr).toContain("1100");
  });

  it("uses the production template for PRODUCTION environment", () => {
    const result = generateCsr({ ...input, environment: ZatcaEnvironment.PRODUCTION });
    const csr = jsrsasign.KJUR.asn1.csr.CSRUtil.getParam(result.csrPem);
    expect(JSON.stringify(csr.extreq)).toContain("ZATCA-Code-Signing");
    expect(JSON.stringify(csr.extreq)).not.toContain("TSTZATCA");
  });

  it("the generated key can sign and the signature verifies", () => {
    const result = generateCsr(input);
    const digest = createHash("sha256").update("test-payload").digest();

    const privHex = jsrsasign.KEYUTIL.getKey(result.privateKeyPem) as jsrsasign.KJUR.crypto.ECDSA;
    const privateKeyHex = (privHex as any).prvKeyHex as string;

    const signature = secp256k1.sign(digest, privateKeyHex);
    const publicKey = secp256k1.getPublicKey(privateKeyHex, false);
    expect(secp256k1.verify(signature.toCompactRawBytes(), digest, publicKey)).toBe(true);
  });
});
