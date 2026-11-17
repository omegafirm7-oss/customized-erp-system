import { fontRegistry } from "./draw";

/**
 * A PDF usually contains only the few letters it needs of each font, so the
 * embedded copy can't spell new words. If the same font is installed on this
 * computer (Arial, Calibri, Times New Roman, Tahoma...) the browser can hand
 * us the full font, which we use for both the preview and the download.
 */
interface LocalFontData {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
  blob: () => Promise<Blob>;
}

let listPromise: Promise<LocalFontData[] | null> | null = null;

async function localFonts(): Promise<LocalFontData[] | null> {
  const query = (window as unknown as { queryLocalFonts?: () => Promise<LocalFontData[]> }).queryLocalFonts;
  if (!query) return null;
  if (!listPromise) {
    listPromise = query.call(window).catch(() => null);
  }
  const list = await listPromise;
  if (!list) listPromise = null; // permission refused: ask again next time
  return list;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The family name inside a PDF font name such as "ABCDEF+Arial-BoldMT" -> "arial". */
function familyOf(pdfName: string) {
  const base = pdfName.replace(/^[A-Z]{6}\+/, "").split(/[-,]/)[0];
  return squash(base.replace(/(PSMT|MT|PS)$/, ""));
}

const matched = new Map<string, { key: string; label: string } | null>();
let counter = 0;

export interface LocalMatch {
  key: string;
  label: string;
}

/** Finds the installed font that the PDF font refers to and registers it for preview and export. */
export async function matchLocalFont(pdfName: string, bold: boolean, italic: boolean): Promise<LocalMatch | null> {
  const clean = pdfName.replace(/^[A-Z]{6}\+/, "");
  const cacheKey = `${clean}|${bold}|${italic}`;
  if (matched.has(cacheKey)) return matched.get(cacheKey) ?? null;

  const fonts = await localFonts();
  if (!fonts) return null;

  const fam = familyOf(pdfName);
  let pick = fonts.find((f) => f.postscriptName === clean);
  if (!pick && fam) {
    const sameFamily = fonts.filter((f) => squash(f.family) === fam || squash(f.fullName).startsWith(fam));
    const styleOf = (f: LocalFontData) => ({
      b: /bold|black|heavy/i.test(f.style),
      i: /italic|oblique/i.test(f.style),
    });
    pick =
      sameFamily.find((f) => styleOf(f).b === bold && styleOf(f).i === italic) ??
      sameFamily.find((f) => styleOf(f).b === bold) ??
      sameFamily[0];
  }
  if (!pick) {
    matched.set(cacheKey, null);
    return null;
  }

  try {
    const bytes = new Uint8Array(await (await pick.blob()).arrayBuffer());
    const css = `uf_${++counter}`;
    const face = new FontFace(css, bytes.slice().buffer);
    await face.load();
    document.fonts.add(face);
    const key = `local:${pick.postscriptName || pick.fullName}`;
    fontRegistry.set(key, { css, data: bytes });
    const result = { key, label: pick.fullName };
    matched.set(cacheKey, result);
    return result;
  } catch {
    matched.set(cacheKey, null);
    return null;
  }
}
