import { SetMetadata } from "@nestjs/common";

export const PERMISSIONS_KEY = "permissions";
export const SENSITIVE_KEY = "permissions:sensitive";

/**
 * Requires the caller's token to embed all listed permission keys.
 * Pass { sensitive: true } for actions (e.g. period close, role changes)
 * that should be re-checked against the DB instead of trusting a token
 * that may be up to accessTtl stale.
 */
export const Permissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);
export const SensitivePermission = () => SetMetadata(SENSITIVE_KEY, true);
