import { SetMetadata } from "@nestjs/common";

export const PERMISSIONS_KEY = "permissions";
export const ANY_PERMISSIONS_KEY = "permissions:any";
export const SENSITIVE_KEY = "permissions:sensitive";

/**
 * Requires the caller's token to embed all listed permission keys.
 * Pass { sensitive: true } for actions (e.g. period close, role changes)
 * that should be re-checked against the DB instead of trusting a token
 * that may be up to accessTtl stale.
 */
export const Permissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Requires at least one of the listed permission keys (OR, not AND).
 * For read-only reference-data endpoints (e.g. chart of accounts, cost
 * centers) that several unrelated modules' forms depend on — a narrow
 * role built for one module (e.g. HR-only) still needs to read them for
 * its own dropdowns, without being granted a conceptually unrelated
 * module's full permission (e.g. GL journal access).
 */
export const AnyPermissions = (...permissions: string[]) => SetMetadata(ANY_PERMISSIONS_KEY, permissions);

export const SensitivePermission = () => SetMetadata(SENSITIVE_KEY, true);
