import { HttpException, HttpStatus, Injectable } from "@nestjs/common";

/**
 * Converting a document is heavy (it starts LibreOffice or a browser) and the
 * endpoints are public, so use is limited per visitor and the server only
 * ever converts one thing at a time, with a short queue behind it.
 */
@Injectable()
export class ConvertLimiter {
  private readonly hits = new Map<string, number[]>();
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  static readonly MAX_PER_WINDOW = Number(process.env.CONVERT_MAX_PER_IP ?? 12);
  static readonly WINDOW_MS = 10 * 60 * 1000;
  static readonly MAX_CONCURRENT = Number(process.env.CONVERT_CONCURRENCY ?? 1);
  static readonly MAX_QUEUE = 4;

  /** Counts this visitor's conversions in the last 10 minutes; throws 429 past the limit. */
  checkRate(ip: string) {
    const now = Date.now();
    const recent = (this.hits.get(ip) ?? []).filter((t) => now - t < ConvertLimiter.WINDOW_MS);
    if (recent.length >= ConvertLimiter.MAX_PER_WINDOW) {
      const waitMin = Math.max(1, Math.ceil((ConvertLimiter.WINDOW_MS - (now - recent[0])) / 60000));
      throw new HttpException(`You've converted a lot of files. Please try again in about ${waitMin} minute${waitMin === 1 ? "" : "s"}.`, HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(now);
    this.hits.set(ip, recent);
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (v.every((t) => now - t >= ConvertLimiter.WINDOW_MS)) this.hits.delete(k);
  }

  /** Runs a job when a slot is free. A full queue is turned away at once instead of piling up. */
  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.running >= ConvertLimiter.MAX_CONCURRENT) {
      if (this.waiting.length >= ConvertLimiter.MAX_QUEUE) {
        throw new HttpException("The converter is busy right now. Please try again in a minute.", HttpStatus.SERVICE_UNAVAILABLE);
      }
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.running++;
    }
    try {
      return await job();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.running--;
    }
  }
}
