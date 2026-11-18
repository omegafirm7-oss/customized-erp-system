import { HttpException, HttpStatus, Injectable } from "@nestjs/common";

/**
 * The AI tools are public and every call costs money, so use is capped three ways:
 * per visitor per hour, across everyone per day, and by how many calls run at once.
 * The unit of account is roughly 4,000 characters of text sent to the model.
 */
@Injectable()
export class AiLimiter {
  private readonly perIp = new Map<string, Array<{ at: number; units: number }>>();
  private day = new Date().toDateString();
  private dayUnits = 0;
  private running = 0;

  static readonly UNIT_CHARS = 4000;
  static readonly IP_UNITS_PER_HOUR = Number(process.env.AI_IP_UNITS_PER_HOUR ?? 60);
  static readonly DAILY_UNITS = Number(process.env.AI_DAILY_UNITS ?? 2000);
  static readonly MAX_CONCURRENT = Number(process.env.AI_CONCURRENCY ?? 6);

  static unitsFor(chars: number) {
    return Math.max(1, Math.ceil(chars / AiLimiter.UNIT_CHARS));
  }

  /** Reserves capacity for one call, or throws 429/503 with a plain explanation. */
  reserve(ip: string, chars: number) {
    const units = AiLimiter.unitsFor(chars);
    const now = Date.now();
    if (this.day !== new Date().toDateString()) {
      this.day = new Date().toDateString();
      this.dayUnits = 0;
    }
    if (this.dayUnits + units > AiLimiter.DAILY_UNITS) {
      throw new HttpException("The free AI tools have reached today's limit. Please try again tomorrow.", HttpStatus.SERVICE_UNAVAILABLE);
    }
    const recent = (this.perIp.get(ip) ?? []).filter((h) => now - h.at < 3600_000);
    const used = recent.reduce((n, h) => n + h.units, 0);
    if (used + units > AiLimiter.IP_UNITS_PER_HOUR) {
      throw new HttpException("You've used a lot of the free AI allowance. Please try again in a while.", HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push({ at: now, units });
    this.perIp.set(ip, recent);
    this.dayUnits += units;
    if (this.perIp.size > 5000) for (const [k, v] of this.perIp) if (v.every((h) => now - h.at >= 3600_000)) this.perIp.delete(k);
  }

  /** Gives capacity back when a call failed before reaching the model, so a failure doesn't use up someone's allowance. */
  refund(ip: string, chars: number) {
    const units = AiLimiter.unitsFor(chars);
    this.dayUnits = Math.max(0, this.dayUnits - units);
    const list = this.perIp.get(ip);
    if (list) {
      const i = list.findIndex((h) => h.units === units);
      if (i >= 0) list.splice(i, 1);
    }
  }

  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.running >= AiLimiter.MAX_CONCURRENT) {
      throw new HttpException("The AI service is busy right now. Please try again in a moment.", HttpStatus.SERVICE_UNAVAILABLE);
    }
    this.running++;
    try {
      return await job();
    } finally {
      this.running--;
    }
  }
}
