import { Ann, BASELINE, FONT_STACK, LINE_HEIGHT } from "./types";

const imageCache = new Map<string, Promise<HTMLImageElement>>();

export function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  let p = imageCache.get(dataUrl);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not read the image"));
      img.src = dataUrl;
    });
    imageCache.set(dataUrl, p);
  }
  return p;
}

const RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-﻿]/;

/** Same rule as dir="auto" in the browser: the first letter decides whether the text runs right-to-left. */
export const hasRtl = (s: string) => {
  for (const ch of s) {
    if (RTL_CHAR.test(ch)) return true;
    if (/[A-Za-zÀ-ɏ]/.test(ch)) return false;
  }
  return false;
};

/** True when every character can be written with the standard PDF Helvetica font (Latin-1 range). */
export const isWinAnsi = (s: string) => /^[\x20-\x7E\xA0-\xFF\n\r\t]*$/.test(s);

export function textFont(size: number, bold: boolean, k: number) {
  return `${bold ? "bold " : ""}${size * k}px ${FONT_STACK}`;
}

/** Width and height of a text annotation in PDF points, measured the way the browser lays it out. */
export function measureText(ctx: CanvasRenderingContext2D, text: string, size: number, bold: boolean) {
  ctx.font = textFont(size, bold, 1);
  const lines = text.split("\n");
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width), 1);
  return { w, h: lines.length * size * LINE_HEIGHT, lines };
}

/** Draws one annotation onto a canvas whose pixels are `k` times the PDF points. */
export async function drawAnn(ctx: CanvasRenderingContext2D, a: Ann, k: number) {
  ctx.save();
  switch (a.kind) {
    case "cover":
      ctx.fillStyle = a.color;
      ctx.fillRect(a.x * k, a.y * k, a.w * k, a.h * k);
      break;
    case "highlight":
      ctx.globalAlpha = 0.4;
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = a.color;
      ctx.fillRect(a.x * k, a.y * k, a.w * k, a.h * k);
      break;
    case "rect":
      ctx.strokeStyle = a.color;
      ctx.lineWidth = a.width * k;
      ctx.strokeRect(a.x * k, a.y * k, a.w * k, a.h * k);
      break;
    case "pen": {
      if (a.points.length === 0) break;
      ctx.strokeStyle = a.color;
      ctx.lineWidth = a.width * k;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(a.points[0][0] * k, a.points[0][1] * k);
      for (const p of a.points.slice(1)) ctx.lineTo(p[0] * k, p[1] * k);
      if (a.points.length === 1) ctx.lineTo(a.points[0][0] * k + 0.01, a.points[0][1] * k);
      ctx.stroke();
      break;
    }
    case "image": {
      const img = await loadImage(a.dataUrl);
      ctx.drawImage(img, a.x * k, a.y * k, a.w * k, a.h * k);
      break;
    }
    case "text": {
      ctx.font = textFont(a.size, a.bold, k);
      ctx.fillStyle = a.color;
      ctx.textBaseline = "alphabetic";
      const lines = a.text.split("\n");
      const rtl = hasRtl(a.text);
      let width = 0;
      ctx.direction = rtl ? "rtl" : "ltr";
      if (rtl) {
        ctx.textAlign = "right";
        width = Math.max(...lines.map((l) => ctx.measureText(l).width), 1) / k;
      }
      lines.forEach((line, i) => {
        const y = (a.y + a.size * BASELINE + i * a.size * LINE_HEIGHT) * k;
        ctx.fillText(line, (rtl ? a.x + width : a.x) * k, y);
      });
      break;
    }
  }
  ctx.restore();
}

/** Renders a single text annotation to a transparent PNG (used when the text can't be written with a standard PDF font). */
export async function textToPng(a: Extract<Ann, { kind: "text" }>, k: number) {
  const probe = document.createElement("canvas").getContext("2d")!;
  const { w, h } = measureText(probe, a.text, a.size, a.bold);
  const pad = 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil((w + pad * 2) * k);
  canvas.height = Math.ceil((h + pad * 2) * k);
  const ctx = canvas.getContext("2d")!;
  ctx.translate((pad - a.x) * k, (pad - a.y) * k);
  await drawAnn(ctx, a, k);
  const blob: Blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG failed"))), "image/png"));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), x: a.x - pad, y: a.y - pad, w: w + pad * 2, h: h + pad * 2 };
}

export const newId = () => Math.random().toString(36).slice(2, 10);

/** Bounding box of an annotation in PDF points. */
export function annBox(a: Ann, probe: CanvasRenderingContext2D): { x: number; y: number; w: number; h: number } {
  switch (a.kind) {
    case "text": {
      const m = measureText(probe, a.text || " ", a.size, a.bold);
      return { x: a.x, y: a.y, w: m.w, h: m.h };
    }
    case "pen": {
      const xs = a.points.map((p) => p[0]);
      const ys = a.points.map((p) => p[1]);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    default:
      return { x: a.x, y: a.y, w: a.w, h: a.h };
  }
}
