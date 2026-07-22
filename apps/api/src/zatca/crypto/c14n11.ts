import { DOMParser } from "@xmldom/xmldom";
import type { Node, Element, Text, CDATASection, ProcessingInstruction } from "@xmldom/xmldom";

/**
 * Canonical XML 1.1 (C14N11) serializer, scoped to what ZATCA invoices
 * actually contain. ZATCA UBL documents have no xml:id/xml:base attributes,
 * no processing instructions inside the document element, and no default
 * attributes from a DTD — so the only rules that matter here are:
 *  - UTF-8, no XML declaration
 *  - empty elements expanded to start/end tag pairs
 *  - attributes sorted (namespace declarations first, by prefix; then
 *    attributes by namespace URI + local name)
 *  - namespace declarations emitted only where they come into scope
 *    (superfluous re-declarations removed)
 *  - character escaping: & < > in text; & < > " and whitespace chars in
 *    attribute values (TAB/LF/CR as character references)
 *  - CDATA sections replaced by their text content
 *  - comments stripped (comment-less canonical form, which is what
 *    XML-DSig's #WithComments-less URI implies)
 */

interface NamespaceContext {
  [prefix: string]: string;
}

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, "&#xD;");
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/\t/g, "&#x9;")
    .replace(/\n/g, "&#xA;")
    .replace(/\r/g, "&#xD;");
}

function canonicalizeNode(node: Node, inheritedNs: NamespaceContext, output: string[]): void {
  switch (node.nodeType) {
    case 1: {
      // ELEMENT_NODE
      const element = node as Element;
      const localNs: NamespaceContext = { ...inheritedNs };

      // Collect namespace declarations and regular attributes separately.
      const nsDecls: Array<{ prefix: string; uri: string }> = [];
      const attrs: Array<{ name: string; nsUri: string; localName: string; value: string }> = [];

      for (let i = 0; i < element.attributes.length; i++) {
        const attr = element.attributes[i];
        if (attr.name === "xmlns") {
          if (inheritedNs[""] !== attr.value) {
            nsDecls.push({ prefix: "", uri: attr.value });
          }
          localNs[""] = attr.value;
        } else if (attr.name.startsWith("xmlns:")) {
          const prefix = attr.name.slice(6);
          if (inheritedNs[prefix] !== attr.value) {
            nsDecls.push({ prefix, uri: attr.value });
          }
          localNs[prefix] = attr.value;
        } else {
          attrs.push({
            name: attr.name,
            nsUri: attr.namespaceURI ?? "",
            localName: attr.localName ?? attr.name,
            value: attr.value,
          });
        }
      }

      // Sort: namespace declarations first by prefix; then attributes by
      // (namespace URI, local name) — attributes without a namespace sort
      // before namespaced ones per the C14N spec's document order rules.
      nsDecls.sort((a, b) => (a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : 0));
      attrs.sort((a, b) => {
        if (a.nsUri !== b.nsUri) return a.nsUri < b.nsUri ? -1 : 1;
        return a.localName < b.localName ? -1 : a.localName > b.localName ? 1 : 0;
      });

      output.push(`<${element.tagName}`);
      for (const ns of nsDecls) {
        const attrName = ns.prefix === "" ? "xmlns" : `xmlns:${ns.prefix}`;
        output.push(` ${attrName}="${escapeAttribute(ns.uri)}"`);
      }
      for (const attr of attrs) {
        output.push(` ${attr.name}="${escapeAttribute(attr.value)}"`);
      }
      output.push(">");

      for (let i = 0; i < element.childNodes.length; i++) {
        canonicalizeNode(element.childNodes[i], localNs, output);
      }

      output.push(`</${element.tagName}>`);
      break;
    }
    case 3: // TEXT_NODE
      output.push(escapeText((node as Text).data));
      break;
    case 4: // CDATA_SECTION_NODE — canonical form is escaped text
      output.push(escapeText((node as CDATASection).data));
      break;
    case 7: {
      // PROCESSING_INSTRUCTION_NODE
      const pi = node as ProcessingInstruction;
      output.push(pi.data ? `<?${pi.target} ${pi.data}?>` : `<?${pi.target}?>`);
      break;
    }
    case 8: // COMMENT_NODE — stripped in comment-less canonical form
      break;
    default:
      break;
  }
}

export function canonicalizeXml(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (!doc.documentElement) {
    throw new Error("Cannot canonicalize: no document element");
  }
  const output: string[] = [];
  canonicalizeNode(doc.documentElement as unknown as Node, {}, output);
  return output.join("");
}
