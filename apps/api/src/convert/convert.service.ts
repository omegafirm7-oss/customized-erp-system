import { BadRequestException, GatewayTimeoutException, Injectable, Logger, UnprocessableEntityException } from "@nestjs/common";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import puppeteer from "puppeteer-core";
import { safeFetch, assertPublicUrl } from "./safe-fetch";
import { assertSafeUpload, OfficeKind, extensionOf } from "./upload-check";

/**
 * Where the converters run. In production they run as a separate, unprivileged
 * system user (CONVERT_RUN_AS) that can't read the application's files, so a
 * hostile document can't reach anything of ours even if it breaks the converter.
 */
const RUN_AS = process.env.CONVERT_RUN_AS || "";
const BASE_DIR = process.env.CONVERT_TMP_DIR || path.join(os.tmpdir(), "pdfconv");
const SOFFICE = process.env.SOFFICE_PATH || "/usr/bin/soffice";
const CHROMIUM = process.env.CHROMIUM_PATH || "/usr/lib64/chromium-browser/headless_shell";

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

  /** A web page, HTML file or pasted HTML -> PDF in headless Chromium, with every network request checked and made by us. */
  async htmlToPdf(opts: HtmlOptions): Promise<Buffer> {
    if (opts.url) assertPublicUrl(opts.url);
    const dir = await this.makeJobDir();
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
    ];
    const wrapped = asConverter(["/usr/bin/timeout", "-k", "5", "100", CHROMIUM, ...flags]);
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
    try {
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
