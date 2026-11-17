import type { PDFDocumentProxy } from "pdfjs-dist";

/** One loaded PDF (the original upload, or a file merged in later). */
export interface PdfSource {
  id: number;
  name: string;
  bytes: Uint8Array;
  pdf: PDFDocumentProxy;
}

/** One page of the working document, in its current order. */
export interface PageRef {
  key: string;
  /** Source file id, or -1 for a blank page. */
  src: number;
  /** 0-based page index inside the source file. */
  index: number;
  /** Extra clockwise rotation (0/90/180/270) added by the user. */
  rotation: number;
  /** Size of a blank page, in PDF points. */
  blank?: { w: number; h: number };
}

/**
 * Everything the user can add to a page. Coordinates are in PDF points on the
 * page exactly as displayed (top-left origin, after any rotation), so they
 * don't depend on the zoom level.
 */
export type Ann =
  | { id: string; kind: "text"; x: number; y: number; text: string; size: number; color: string; bold: boolean; italic: boolean; serif: boolean }
  | { id: string; kind: "cover"; x: number; y: number; w: number; h: number; color: string }
  | { id: string; kind: "rect"; x: number; y: number; w: number; h: number; color: string; width: number }
  | { id: string; kind: "highlight"; x: number; y: number; w: number; h: number; color: string }
  | { id: string; kind: "pen"; points: Array<[number, number]>; color: string; width: number }
  | { id: string; kind: "image"; x: number; y: number; w: number; h: number; dataUrl: string };

export type Tool = "select" | "edit" | "text" | "cover" | "highlight" | "rect" | "pen";

/** The undoable part of the editor state. */
export interface DocState {
  pages: PageRef[];
  anns: Record<string, Ann[]>;
}

export const LINE_HEIGHT = 1.2;
/** Where the text baseline sits inside a line box, as a fraction of the font size (Arial/Helvetica metrics). */
export const BASELINE = 0.9465;

export const FONT_STACK = 'Helvetica, Arial, "Noto Naskh Arabic", "Segoe UI", sans-serif';
export const SERIF_STACK = '"Times New Roman", Times, "Noto Naskh Arabic", serif';
