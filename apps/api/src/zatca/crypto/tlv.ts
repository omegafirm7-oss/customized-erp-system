/**
 * ZATCA QR code TLV (tag-length-value) codec. Each field is encoded as
 * 1-byte tag, 1-byte length, then the raw value bytes; the concatenated
 * buffer is base64-encoded into the QR payload.
 *
 * Tags: 1 seller name, 2 seller VAT number, 3 invoice timestamp (ISO8601),
 * 4 invoice total with VAT, 5 VAT total, 6 invoice hash (base64 string),
 * 7 ECDSA signature (raw bytes), 8 EGS public key (DER bytes),
 * 9 ZATCA CA signature over the stamp certificate (simplified only).
 */

export interface TlvField {
  tag: number;
  value: Buffer;
}

export function encodeTlv(fields: TlvField[]): Buffer {
  const parts: Buffer[] = [];
  for (const field of fields) {
    if (field.tag < 1 || field.tag > 255) {
      throw new Error(`TLV tag out of range: ${field.tag}`);
    }
    if (field.value.length > 255) {
      throw new Error(`TLV value too long for tag ${field.tag}: ${field.value.length} bytes`);
    }
    parts.push(Buffer.from([field.tag, field.value.length]), field.value);
  }
  return Buffer.concat(parts);
}

export function decodeTlv(buffer: Buffer): TlvField[] {
  const fields: TlvField[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    if (offset + 2 > buffer.length) {
      throw new Error("Truncated TLV buffer");
    }
    const tag = buffer[offset];
    const length = buffer[offset + 1];
    if (offset + 2 + length > buffer.length) {
      throw new Error(`Truncated TLV value for tag ${tag}`);
    }
    fields.push({ tag, value: buffer.subarray(offset + 2, offset + 2 + length) });
    offset += 2 + length;
  }
  return fields;
}

export interface QrData {
  sellerName: string;
  sellerVatNumber: string;
  timestamp: string;
  invoiceTotal: string;
  vatTotal: string;
  invoiceHash: string;
  signature: Buffer;
  publicKey: Buffer;
  /** ZATCA CA signature over the stamp certificate — simplified invoices only. */
  certificateSignature?: Buffer;
}

export function buildQrPayload(data: QrData): string {
  const fields: TlvField[] = [
    { tag: 1, value: Buffer.from(data.sellerName, "utf8") },
    { tag: 2, value: Buffer.from(data.sellerVatNumber, "utf8") },
    { tag: 3, value: Buffer.from(data.timestamp, "utf8") },
    { tag: 4, value: Buffer.from(data.invoiceTotal, "utf8") },
    { tag: 5, value: Buffer.from(data.vatTotal, "utf8") },
    { tag: 6, value: Buffer.from(data.invoiceHash, "utf8") },
    { tag: 7, value: data.signature },
    { tag: 8, value: data.publicKey },
  ];
  if (data.certificateSignature) {
    fields.push({ tag: 9, value: data.certificateSignature });
  }
  return encodeTlv(fields).toString("base64");
}
