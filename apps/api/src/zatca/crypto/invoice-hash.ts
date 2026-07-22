import { createHash } from "crypto";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type { Node, Element } from "@xmldom/xmldom";
import { canonicalizeXml } from "./c14n11";

/**
 * ZATCA invoice hash: remove ext:UBLExtensions, cac:Signature, and the QR
 * AdditionalDocumentReference; canonicalize (C14N11); SHA-256; base64.
 * The PIH (previous invoice hash) chain and the XAdES signature reference
 * are both built on this digest.
 */

/** PIH seed for the first invoice of a device: base64(hex(sha256("0"))). */
export const PIH_SEED = "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==";

export function stripForHashing(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const root = doc.documentElement;
  if (!root) {
    throw new Error("Invalid invoice XML");
  }

  const toRemove: Node[] = [];
  for (let i = 0; i < root.childNodes.length; i++) {
    const child = root.childNodes[i] as Element;
    if (child.nodeType !== 1) continue;
    const local = child.localName;
    if (local === "UBLExtensions") {
      toRemove.push(child as unknown as Node);
    } else if (local === "Signature") {
      toRemove.push(child as unknown as Node);
    } else if (local === "AdditionalDocumentReference") {
      // Remove only the QR document reference
      for (let j = 0; j < child.childNodes.length; j++) {
        const grandchild = child.childNodes[j] as Element;
        if (grandchild.nodeType === 1 && grandchild.localName === "ID" && grandchild.textContent === "QR") {
          toRemove.push(child as unknown as Node);
          break;
        }
      }
    }
  }
  for (const node of toRemove) {
    root.removeChild(node as never);
  }

  return new XMLSerializer().serializeToString(doc as never);
}

export function computeInvoiceHash(xml: string): string {
  const stripped = stripForHashing(xml);
  const canonical = canonicalizeXml(stripped);
  return createHash("sha256").update(canonical, "utf8").digest("base64");
}

/** Raw digest bytes of the canonicalized stripped invoice — what gets ECDSA-signed. */
export function computeInvoiceDigestBytes(xml: string): Buffer {
  const stripped = stripForHashing(xml);
  const canonical = canonicalizeXml(stripped);
  return createHash("sha256").update(canonical, "utf8").digest();
}
