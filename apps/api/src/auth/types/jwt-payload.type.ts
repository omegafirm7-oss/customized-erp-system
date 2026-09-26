export interface JwtPayload {
  sub: string;
  email: string;
  activeCompanyId: string | null;
  roleId: string | null;
  roleName: string | null;
  permissions: string[];
  isPlatformAdmin: boolean;
  enabledModules: string[];
  /** Active company country (ISO alpha-2) — drives country-specific UI (SA/ZATCA vs PK/FBR). */
  countryCode?: string | null;
}
