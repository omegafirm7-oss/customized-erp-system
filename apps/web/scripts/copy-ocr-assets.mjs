// Copies the OCR engine files from node_modules into public/ocr so they are served from our own site
// (nothing is fetched from a third-party CDN). Runs before dev and build.
import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "public", "ocr");
mkdirSync(out, { recursive: true });

const require = createRequire(import.meta.url);
const tessDir = dirname(require.resolve("tesseract.js/package.json"));
const coreDir = dirname(createRequire(join(tessDir, "package.json")).resolve("tesseract.js-core/package.json"));

cpSync(join(tessDir, "dist", "worker.min.js"), join(out, "worker.min.js"));
// Every build variant: Tesseract.js picks the best one for the visitor's browser (relaxed SIMD, SIMD, plain).
for (const f of readdirSync(coreDir).filter((n) => /^tesseract-core.*.wasm.js$/.test(n))) {
  cpSync(join(coreDir, f), join(out, f));
}
console.log("OCR engine files copied to public/ocr");
