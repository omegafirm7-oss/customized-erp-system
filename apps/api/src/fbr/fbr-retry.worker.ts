import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppConfig } from "../core/config/configuration";
import { FbrSubmissionService } from "./fbr-submission.service";

/**
 * Re-submits PENDING (transient failure) and FAILED (auth) FBR submissions
 * in the background, so a POS sale made during an FBR outage still gets its
 * fiscal number without anyone pressing Retry. A plain interval (not a
 * cron library): single API instance, and ticks never overlap.
 * FBR_RETRY_INTERVAL_MS=0 disables it (tests call retryDue() directly).
 */
@Injectable()
export class FbrRetryWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(FbrRetryWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly submissionService: FbrSubmissionService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  onApplicationBootstrap() {
    const intervalMs = this.configService.get("fbr", { infer: true }).retryIntervalMs;
    if (!intervalMs || process.env.NODE_ENV === "test") return;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const { candidates, attempted } = await this.submissionService.retryDue();
      if (attempted > 0) this.logger.log(`FBR retry: attempted ${attempted} of ${candidates} outstanding submissions`);
    } catch (error) {
      this.logger.error(`FBR retry tick failed: ${error instanceof Error ? error.message : error}`);
    } finally {
      this.running = false;
    }
  }
}
