import { readFileSync } from "fs";
import * as common from "oci-common";
import { BlockstorageClient, ComputeClient, models as coreModels } from "oci-core";
import { LoadBalancerClient } from "oci-loadbalancer";
import { UsageapiClient, models as usageapiModels } from "oci-usageapi";
import { AppConfig } from "../../core/config/configuration";

export interface CloudUsageCost {
  monthToDateUsd: number;
  currency: string;
  byService: { service: string; amountUsd: number }[];
}

export interface CloudUsageCompute {
  ocpusUsed: number;
  memoryGbUsed: number;
  instanceCount: number;
}

export interface CloudUsageBlockStorage {
  gbUsed: number;
  volumeCount: number;
}

export interface CloudUsageProvider {
  getCost(): Promise<CloudUsageCost>;
  getCompute(): Promise<CloudUsageCompute>;
  getBlockStorage(): Promise<CloudUsageBlockStorage>;
  getLoadBalancerCount(): Promise<number>;
}

/** DI token — resolves to `null` when OCI isn't configured (see the factory in cloud-usage.module-provider.ts), so CloudUsageService degrades gracefully instead of every caller re-checking config. */
export const CLOUD_USAGE_PROVIDER = Symbol("CLOUD_USAGE_PROVIDER");

type OciConfig = AppConfig["oci"];

export function isOciConfigured(config: OciConfig): boolean {
  return Boolean(
    config.tenancyOcid &&
      config.userOcid &&
      config.fingerprint &&
      config.privateKeyPath &&
      config.region &&
      config.homeRegion &&
      config.compartmentId,
  );
}

/**
 * Thin wrapper around the OCI SDK, kept behind the CloudUsageProvider
 * interface so tests exercise a fake instead of Oracle's wire format
 * directly. Auth is built straight from config fields (tenancy/user/
 * fingerprint/key file path) rather than a `~/.oci/config` ini file, to
 * stay consistent with how every other integration in this app is
 * configured (see configuration.ts) — the private key file itself is
 * generated directly on the server and never passes through this app's
 * own config storage.
 *
 * Queries only the single configured compartment (not a subtree scan):
 * none of the OCI Core/Block-Storage/Load-Balancer list APIs used here
 * support recursive compartment scanning, and this app's own deployment
 * is a single instance in one compartment, so that's not a real gap.
 */
export class OciCloudUsageProvider implements CloudUsageProvider {
  private readonly tenancyOcid: string;
  private readonly compartmentId: string;
  private readonly usageClient: UsageapiClient;
  private readonly computeClient: ComputeClient;
  private readonly blockstorageClient: BlockstorageClient;
  private readonly loadBalancerClient: LoadBalancerClient;

  constructor(config: OciConfig) {
    this.tenancyOcid = config.tenancyOcid;
    this.compartmentId = config.compartmentId;

    const privateKey = readFileSync(config.privateKeyPath, "utf8");
    const authProvider = new common.SimpleAuthenticationDetailsProvider(
      config.tenancyOcid,
      config.userOcid,
      config.fingerprint,
      privateKey,
      null,
    );

    this.usageClient = new UsageapiClient({ authenticationDetailsProvider: authProvider });
    this.usageClient.region = common.Region.fromRegionId(config.homeRegion);

    this.computeClient = new ComputeClient({ authenticationDetailsProvider: authProvider });
    this.computeClient.region = common.Region.fromRegionId(config.region);

    this.blockstorageClient = new BlockstorageClient({ authenticationDetailsProvider: authProvider });
    this.blockstorageClient.region = common.Region.fromRegionId(config.region);

    this.loadBalancerClient = new LoadBalancerClient({ authenticationDetailsProvider: authProvider });
    this.loadBalancerClient.region = common.Region.fromRegionId(config.region);
  }

  async getCost(): Promise<CloudUsageCost> {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    // DAILY granularity requires both bounds on a UTC midnight, with the end
    // exclusive — so run through the start of tomorrow, not "now". OCI's
    // cost data also lags by several hours, so today's figure can be partial.
    const rangeEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const res = await this.usageClient.requestSummarizedUsages({
      requestSummarizedUsagesDetails: {
        tenantId: this.tenancyOcid,
        timeUsageStarted: monthStart,
        timeUsageEnded: rangeEnd,
        granularity: usageapiModels.RequestSummarizedUsagesDetails.Granularity.Daily,
        queryType: usageapiModels.RequestSummarizedUsagesDetails.QueryType.Cost,
        groupBy: ["service"],
      },
    });

    const byServiceTotals = new Map<string, number>();
    let currency = "USD";
    for (const item of res.usageAggregation.items) {
      const service = item.service ?? "Other";
      const amount = item.computedAmount ?? 0;
      byServiceTotals.set(service, (byServiceTotals.get(service) ?? 0) + amount);
      if (item.currency) currency = item.currency;
    }

    const byService = Array.from(byServiceTotals, ([service, amountUsd]) => ({ service, amountUsd })).sort(
      (a, b) => b.amountUsd - a.amountUsd,
    );
    const monthToDateUsd = byService.reduce((sum, s) => sum + s.amountUsd, 0);

    return { monthToDateUsd, currency, byService };
  }

  async getCompute(): Promise<CloudUsageCompute> {
    const res = await this.computeClient.listInstances({
      compartmentId: this.compartmentId,
      lifecycleState: "RUNNING",
    });
    let ocpusUsed = 0;
    let memoryGbUsed = 0;
    for (const instance of res.items) {
      ocpusUsed += instance.shapeConfig?.ocpus ?? 0;
      memoryGbUsed += instance.shapeConfig?.memoryInGBs ?? 0;
    }
    return { ocpusUsed, memoryGbUsed, instanceCount: res.items.length };
  }

  async getBlockStorage(): Promise<CloudUsageBlockStorage> {
    const [bootVolumes, volumes] = await Promise.all([
      this.blockstorageClient.listBootVolumes({ compartmentId: this.compartmentId }),
      this.blockstorageClient.listVolumes({ compartmentId: this.compartmentId }),
    ]);
    const live = (state: coreModels.BootVolume.LifecycleState | coreModels.Volume.LifecycleState | string) =>
      state !== "TERMINATED" && state !== "TERMINATING";
    const bootGb = bootVolumes.items.filter((v) => live(v.lifecycleState)).reduce((sum, v) => sum + (v.sizeInGBs ?? 0), 0);
    const blockGb = volumes.items.filter((v) => live(v.lifecycleState)).reduce((sum, v) => sum + (v.sizeInGBs ?? 0), 0);
    const volumeCount =
      bootVolumes.items.filter((v) => live(v.lifecycleState)).length + volumes.items.filter((v) => live(v.lifecycleState)).length;
    return { gbUsed: bootGb + blockGb, volumeCount };
  }

  async getLoadBalancerCount(): Promise<number> {
    const res = await this.loadBalancerClient.listLoadBalancers({ compartmentId: this.compartmentId });
    return res.items.filter((lb) => lb.lifecycleState !== "DELETED").length;
  }
}
