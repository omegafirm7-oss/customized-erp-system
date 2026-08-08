import { SetMetadata } from "@nestjs/common";
import { ModuleKey } from "@erp/shared-constants";

export const REQUIRES_MODULE_KEY = "requiresModule";

/**
 * Gates a controller/route behind a premium module the caller's active
 * company must be entitled to (see Company.enabledModules). Distinct from
 * @Permissions() — permissions are per-user-role within a company the
 * tenant already has; this is per-tenant, whether the company bought the
 * module at all. Platform admins bypass this check entirely.
 */
export const RequiresModule = (module: ModuleKey) => SetMetadata(REQUIRES_MODULE_KEY, module);
