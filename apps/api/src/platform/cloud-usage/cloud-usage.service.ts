import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { computeStatus, UsageStatus } from "./cloud-usage.util";
import { CLOUD_USAGE_PROVIDER, CloudUsageProvider } from "./cloud-usage.provider";

// Always Free entitlements are fixed, documented Oracle limits — not
// something exposed as a queryable "remaining entitlement" API, so these
// are hardcoded rather than read from OCI.
const FREE_TIER_CAPS = {
  ocpus: 4,
  memoryGb: 24,
  blockStorageGb: 200,
  loadBalancers: 1,
} as const;

const CACHE_TTL_MS = 30 * 60 * 1000;

export interface CloudUsageSnapshot {
  configured: boolean;
  checkedAt: string | null;
  cost: { monthToDateUsd: number; currency: string; byService: { service: string; amountUsd: number }[] } | null;
  compute: { ocpusUsed: number; ocpusCap: number; memoryGbUsed: number; memoryGbCap: number; status: UsageStatus };
  blockStorage: { gbUsed: number; gbCap: number; volumeCount: number; status: UsageStatus };
  loadBalancers: { count: number; cap: number; status: UsageStatus };
  error?: string;
}

@Injectable()
export class CloudUsageService {
  private readonly logger = new Logger(CloudUsageService.name);
  private cached: CloudUsageSnapshot | null = null;
  private cachedAtMs = 0;

  constructor(@Optional() @Inject(CLOUD_USAGE_PROVIDER) private readonly provider: CloudUsageProvider | null) {}

  async getSnapshot(force = false): Promise<CloudUsageSnapshot> {
    if (!this.provider) {
      return this.notConfiguredSnapshot();
    }
    if (!force && this.cached && Date.now() - this.cachedAtMs < CACHE_TTL_MS) {
      return this.cached;
    }

    try {
      const [cost, compute, blockStorage, loadBalancerCount] = await Promise.all([
        this.provider.getCost(),
        this.provider.getCompute(),
        this.provider.getBlockStorage(),
        this.provider.getLoadBalancerCount(),
      ]);

      const snapshot: CloudUsageSnapshot = {
        configured: true,
        checkedAt: new Date().toISOString(),
        cost,
        compute: {
          ocpusUsed: compute.ocpusUsed,
          ocpusCap: FREE_TIER_CAPS.ocpus,
          memoryGbUsed: compute.memoryGbUsed,
          memoryGbCap: FREE_TIER_CAPS.memoryGb,
          status: this.worseStatus(
            computeStatus(compute.ocpusUsed, FREE_TIER_CAPS.ocpus),
            computeStatus(compute.memoryGbUsed, FREE_TIER_CAPS.memoryGb),
          ),
        },
        blockStorage: {
          gbUsed: blockStorage.gbUsed,
          gbCap: FREE_TIER_CAPS.blockStorageGb,
          volumeCount: blockStorage.volumeCount,
          status: computeStatus(blockStorage.gbUsed, FREE_TIER_CAPS.blockStorageGb),
        },
        loadBalancers: {
          count: loadBalancerCount,
          cap: FREE_TIER_CAPS.loadBalancers,
          status: computeStatus(loadBalancerCount, FREE_TIER_CAPS.loadBalancers),
        },
      };
      this.cached = snapshot;
      this.cachedAtMs = Date.now();
      return snapshot;
    } catch (err) {
      this.logger.error(`getSnapshot() OCI call failed: ${(err as Error).message}`);
      // A live OCI outage right after a deploy shouldn't render as "usage
      // is fine" — surface the failure explicitly rather than serving
      // possibly-stale cached numbers as if they were fresh.
      return {
        ...this.notConfiguredSnapshot(),
        configured: true,
        error: "Couldn't reach OCI — will retry on next check.",
      };
    }
  }

  private worseStatus(a: UsageStatus, b: UsageStatus): UsageStatus {
    const rank: Record<UsageStatus, number> = { ok: 0, warning: 1, over: 2 };
    return rank[a] >= rank[b] ? a : b;
  }

  private notConfiguredSnapshot(): CloudUsageSnapshot {
    return {
      configured: false,
      checkedAt: null,
      cost: null,
      compute: { ocpusUsed: 0, ocpusCap: FREE_TIER_CAPS.ocpus, memoryGbUsed: 0, memoryGbCap: FREE_TIER_CAPS.memoryGb, status: "ok" },
      blockStorage: { gbUsed: 0, gbCap: FREE_TIER_CAPS.blockStorageGb, volumeCount: 0, status: "ok" },
      loadBalancers: { count: 0, cap: FREE_TIER_CAPS.loadBalancers, status: "ok" },
    };
  }
}
