import { BadRequestException, GatewayTimeoutException, Injectable, Logger, UnprocessableEntityException } from "@nestjs/common";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Browser } from "puppeteer-core";
import { safeFetch, assertPublicUrl } from "./safe-fetch";
import { assertPdfUpload, assertSafeUpload, OfficeKind, extensionOf } from "./upload-check";

/**
 * Where the converters run. In production they run as a separate, unprivileged
 * system user (CONVERT_RUN_AS) that can't read the application's files, so a
 * hostile document can't reach anything of ours even if it breaks the converter.
 */
const RUN_AS = process.env.CONVERT_RUN_AS || "";
const BASE_DIR = process.env.CONVERT_TMP_DIR || path.join(os.tmpdir(), "pdfconv");
const SOFFICE = process.env.SOFFICE_PATH || "/usr/bin/soffice";
const CHROMIUM = process.env.CHROMIUM_PATH || "/usr/lib64/chromium-browser/headless_shell";
const GS = process.env.GS_PATH || "/usr/bin/gs";
const GS_SHARE = process.env.GS_SHARE_DIR || "/usr/share/ghostscript";

/** Command prefix that drops to the converter user and makes files group-writable so the API can clean up. */
const asConverter = (argv: string[]): string[] => {
  const inner = ["/bin/sh", "-c", 'umask 002; exec "$@"', "sh", ...argv];
  return RUN_AS ? ["/usr/bin/sudo", "-n", "-u", RUN_AS, ...inner] : argv;
};

export interface HtmlOptions {
  url?: string;
  html?: string;
  pageSize: "A4" | "Letter";
  landscape: boolean;
  marginMm: number;
  background: boolean;
}

@Injectable()
export class ConvertService {
  private readonly logger = new Logger(ConvertService.name);

  private async makeJobDir() {
    await fs.mkdir(BASE_DIR, { recursive: true, mode: 0o2770 });
    const dir = await fs.mkdtemp(path.join(BASE_DIR, "job-"));
    await fs.chmod(dir, 0o2770); // setgid: new files inherit the converter group, which both users share
    return dir;
  }

  private async cleanup(dir: string) {
    try {
      if (RUN_AS) await this.run(asConverter(["/bin/rm", "-rf", dir]), 15000).catch(() => undefined);
      await fs.rm(dir, { recursive: true, force: true });
    } catch (err) {
      this.logger.warn(`Could not remove ${dir}: ${(err as Error).message}`);
    }
  }

  private run(argv: string[], timeoutMs: number): Promise<{ code: number | null; stderr: string }> {
    return new Promise((resolve, reject) => {
      const [cmd, ...args] = argv;
      const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"], detached: true });
      let stderr = "";
      child.stderr!.on("data", (d: Buffer) => {
        if (stderr.length < 4000) stderr += d.toString();
      });
      const timer = setTimeout(() => {
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
        reject(new GatewayTimeoutException("The conversion took too long. Try a smaller or simpler file."));
      }, timeoutMs);
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stderr });
      });
    });
  }

  /** Word, PowerPoint and similar documents -> PDF with LibreOffice (no network inside the conversion). */
  async officeToPdf(file: { originalname: string; buffer: Buffer }, kind: OfficeKind): Promise<Buffer> {
    const ext = extensionOf(file.originalname);
    assertSafeUpload(file.buffer, ext, kind);
    const dir = await this.makeJobDir();
    try {
      const input = path.join(dir, `input.${ext}`);
      const outDir = path.join(dir, "out");
      await fs.mkdir(outDir, { mode: 0o770 });
      await fs.chmod(outDir, 0o2770);
      await fs.writeFile(input, file.buffer, { mode: 0o660 });
      const argv = asConverter([
        "/usr/bin/unshare",
        "-rn",
        "/usr/bin/timeout",
        "-k",
        "5",
        "100",
        "/usr/bin/env",
        `HOME=${dir}`,
        SOFFICE,
        "--headless",
        "--norestore",
        "--nolockcheck",
        "--nodefault",
        "--nofirststartwizard",
        `-env:UserInstallation=file://${dir}/profile`,
        "--convert-to",
        "pdf",
        "--outdir",
        outDir,
        input,
      ]);
      const { code, stderr } = await this.run(argv, 115000);
      let pdf: Buffer;
      try {
        pdf = await fs.readFile(path.join(outDir, "input.pdf"));
      } catch {
        this.logger.warn(`LibreOffice failed (exit ${code}): ${stderr.slice(0, 300)}`);
        throw new UnprocessableEntityException("This file could not be converted. It may be damaged, password-protected or in an unsupported format.");
      }
      if (pdf.length === 0) throw new UnprocessableEntityException("The conversion produced an empty file.");
      return pdf;
    } finally {
      await this.cleanup(dir);
    }
  }

  /**
   * Any PDF -> PDF/A (archival) with Ghostscript: fonts embedded, colours in sRGB, transparency and
   * other features the standard forbids removed. Runs as the converter user with no network.
   */
  async pdfToPdfa(file: { originalname: string; buffer: Buffer }, level: 1 | 2 | 3): Promise<Buffer> {
    assertPdfUpload(file.buffer);
    let template: string;
    try {
      template = await fs.readFile(path.join(GS_SHARE, "lib", "PDFA_def.ps"), "utf8");
    } catch {
      this.logger.error("Ghostscript's PDF/A template was not found; is ghostscript installed?");
      throw new UnprocessableEntityException("PDF/A conversion is not available right now.");
    }
    const icc = path.join(GS_SHARE, "iccprofiles", "srgb.icc");
    const title = file.originalname.replace(/\.[^.]+$/, "").replace(/[()\\]/g, " ").slice(0, 120) || "Document";
    const dir = await this.makeJobDir();
    try {
      const input = path.join(dir, "input.pdf");
      const output = path.join(dir, "out.pdf");
      const def = path.join(dir, "PDFA_def.ps");
      await fs.writeFile(input, file.buffer, { mode: 0o660 });
      await fs.writeFile(def, template.split("(srgb.icc)").join(`(${icc})`).replace("/Title (Title)", `/Title (${title})`), { mode: 0o660 });
      const argv = asConverter([
        "/usr/bin/unshare",
        "-rn",
        "/usr/bin/timeout",
        "-k",
        "5",
        "100",
        GS,
        "-dBATCH",
        "-dNOPAUSE",
        "-dQUIET",
        "-dSAFER",
        `-dPDFA=${level}`,
        "-dPDFACompatibilityPolicy=1",
        "-sColorConversionStrategy=RGB",
        "-sProcessColorModel=DeviceRGB",
        "-dEmbedAllFonts=true",
        "-sDEVICE=pdfwrite",
        `--permit-file-read=${icc}`,
        `--permit-file-read=${def}`,
        `-sOutputFile=${output}`,
        def,
        input,
      ]);
      const { code, stderr } = await this.run(argv, 115000);
      let pdf: Buffer | null = null;
      try {
        pdf = await fs.readFile(output);
      } catch {
        /* handled below */
      }
      // Ghostscript can write a (blank) file even when it hit an error, so any reported error counts as a failure.
      if (!pdf || /Error:|Unrecoverable error/.test(stderr)) {
        this.logger.warn(`Ghostscript failed (exit ${code}): ${stderr.slice(0, 300)}`);
        throw new UnprocessableEntityException("This PDF could not be converted to PDF/A. It may be damaged or password-protected.");
      }
      if (pdf.length < 100 || !pdf.includes("pdfaid:part")) throw new UnprocessableEntityException("This PDF could not be converted to PDF/A.");
      return pdf;
    } finally {
      await this.cleanup(dir);
    }
  }

  /** A web page, HTML file or pasted HTML -> PDF in headless Chromium, with every network request checked and made by us. */
  async htmlToPdf(opts: HtmlOptions): Promise<Buffer> {
    if (opts.url) assertPublicUrl(opts.url);
    const dir = await this.makeJobDir();
    // Chromium writes its control address into the profile folder; make that folder readable by us too.
    await fs.mkdir(path.join(dir, "profile"), { mode: 0o2770 });
    await fs.chmod(path.join(dir, "profile"), 0o2770);
    const flags = [
      "--headless",
      "--remote-debugging-port=0",
      `--user-data-dir=${dir}/profile`,
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--mute-audio",
      "--hide-scrollbars",
      // The stripped-down headless browser opens no page unless given one, and Puppeteer waits for it.
      "about:blank",
    ];
    const wrapped = asConverter(["/usr/bin/timeout", "-k", "5", "100", CHROMIUM, ...flags]);
    let browser: Browser | null = null;
    try {
      // Loaded only when a page is actually converted (the library is ESM-only, which the test runner can't load up front).
      const { default: puppeteer } = await import("puppeteer-core");
      browser = await puppeteer.launch({
        executablePath: wrapped[0],
        args: wrapped.slice(1),
        ignoreDefaultArgs: true,
        pipe: false,
        timeout: 30000,
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false,
      });
      const page = await browser.newPage();
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      let count = 0;
      let total = 0;
      page.on("request", async (req) => {
        const u = req.url();
        try {
          if (u.startsWith("data:") || u === "about:blank") return await req.continue();
          if (!/^https?:/i.test(u) || ++count > 80) return await req.abort("blockedbyclient");
          const r = await safeFetch(u, { maxBytes: 8 * 1024 * 1024, timeoutMs: 12000 });
          total += r.body.length;
          if (total > 40 * 1024 * 1024) return await req.abort("blockedbyclient");
          await req.respond({ status: r.status, contentType: r.contentType, body: r.body });
        } catch {
          try {
            await req.abort("failed");
          } catch {
            /* the request was already handled */
          }
        }
      });
      if (opts.url) {
        const res = await page.goto(opts.url, { waitUntil: "load", timeout: 45000 });
        if (!res || (res.status() >= 400 && res.status() !== 0)) {
          throw new UnprocessableEntityException(`That page could not be loaded${res ? ` (the website answered ${res.status()})` : ""}.`);
        }
      } else {
        await page.setContent(opts.html ?? "", { waitUntil: "load", timeout: 30000 });
      }
      const m = `${opts.marginMm}mm`;
      const pdf = await page.pdf({
        format: opts.pageSize,
        landscape: opts.landscape,
        printBackground: opts.background,
        margin: { top: m, right: m, bottom: m, left: m },
        timeout: 60000,
      });
      const out = Buffer.from(pdf);
      if (out.length > 60 * 1024 * 1024) throw new UnprocessableEntityException("The resulting PDF is too large.");
      return out;
    } catch (err) {
      if (err instanceof BadRequestException || err instanceof UnprocessableEntityException || err instanceof GatewayTimeoutException) throw err;
      this.logger.warn(`HTML conversion failed: ${(err as Error).message}`);
      if (/timeout/i.test((err as Error).message)) throw new GatewayTimeoutException("That page took too long to load.");
      throw new UnprocessableEntityException("That page could not be converted to PDF.");
    } finally {
      try {
        await browser?.close();
      } catch {
        /* already gone */
      }
      await this.cleanup(dir);
    }
  }
}
