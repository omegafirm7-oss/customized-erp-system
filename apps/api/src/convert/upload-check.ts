import { BadRequestException, UnsupportedMediaTypeException } from "@nestjs/common";

export type OfficeKind = "word" | "powerpoint";

const ALLOWED: Record<OfficeKind, string[]> = {
  word: ["doc", "docx", "odt", "rtf", "txt"],
  powerpoint: ["ppt", "pptx", "odp"],
};

export const extensionOf = (name: string) => (/\.([A-Za-z0-9]{2,5})$/.exec(name)?.[1] ?? "").toLowerCase();

const startsWith = (buf: Buffer, bytes: number[]) => bytes.every((b, i) => buf[i] === b);

/**
 * A .docx/.pptx/.odt/.odp is a zip file. Reads the zip's table of contents
 * (without unpacking anything) and refuses files that would expand into a
 * huge amount of data, which is how "zip bombs" are built.
 */
export function assertZipIsSane(buf: Buffer) {
  const MAX_ENTRIES = 6000;
  const MAX_TOTAL = 500 * 1024 * 1024;
  const MAX_ONE = 200 * 1024 * 1024;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new BadRequestException("This file looks damaged (its zip structure is unreadable).");
  const entries = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  if (entries > MAX_ENTRIES) throw new BadRequestException("This file contains too many parts to convert safely.");
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) throw new BadRequestException("This file looks damaged (its zip structure is unreadable).");
    const size = buf.readUInt32LE(pos + 24);
    if (size > MAX_ONE) throw new BadRequestException("This file contains a part that is too large to convert safely.");
    total += size;
    if (total > MAX_TOTAL) throw new BadRequestException("This file would expand to too much data to convert safely.");
    pos += 46 + buf.readUInt16LE(pos + 28) + buf.readUInt16LE(pos + 30) + buf.readUInt16LE(pos + 32);
  }
}

/** Checks that the upload really is the kind of document its extension claims, before it goes anywhere near a converter. */
export function assertSafeUpload(buf: Buffer, ext: string, kind: OfficeKind) {
  if (!ALLOWED[kind].includes(ext)) {
    throw new UnsupportedMediaTypeException(`Please upload a ${ALLOWED[kind].map((e) => "." + e).join(", ")} file.`);
  }
  if (buf.length < 8) throw new BadRequestException("That file is empty.");
  if (["docx", "pptx", "odt", "odp"].includes(ext)) {
    if (!startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) throw new BadRequestException(`That file isn't a real .${ext} document.`);
    assertZipIsSane(buf);
  } else if (["doc", "ppt"].includes(ext)) {
    if (!startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) throw new BadRequestException(`That file isn't a real .${ext} document.`);
  } else if (ext === "rtf") {
    if (buf.subarray(0, 5).toString("latin1") !== "{\\rtf") throw new BadRequestException("That file isn't a real .rtf document.");
  } else if (ext === "txt") {
    if (buf.subarray(0, 8192).includes(0)) throw new BadRequestException("That file isn't a plain text document.");
  }
}

/** A PDF upload must really start like a PDF (the header may follow a few bytes of junk, as the spec allows). */
export function assertPdfUpload(buf: Buffer) {
  if (buf.length < 100) throw new BadRequestException("That file is too small to be a PDF.");
  if (!buf.subarray(0, 1024).toString("latin1").includes("%PDF-")) throw new BadRequestException("That file isn't a PDF.");
}
