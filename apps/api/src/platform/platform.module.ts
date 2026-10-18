import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PlatformController } from "./platform.controller";
import { PlatformService } from "./platform.service";
import { CloudUsageService } from "./cloud-usage/cloud-usage.service";
import { CLOUD_USAGE_PROVIDER, isOciConfigured, OciCloudUsageProvider } from "./cloud-usage/cloud-usage.provider";
import { AppConfig } from "../core/config/configuration";

@Module({
  controllers: [PlatformController],
  providers: [
    PlatformService,
    CloudUsageService,
    {
      provide: CLOUD_USAGE_PROVIDER,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => {
        const oci = configService.get("oci", { infer: true });
        return isOciConfigured(oci) ? new OciCloudUsageProvider(oci) : null;
      },
    },
  ],
})
export class PlatformModule {}
