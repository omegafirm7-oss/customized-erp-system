export interface DecodedAccessToken {
  sub: string;
  email: string;
  activeCompanyId: string | null;
  roleId: string | null;
  roleName: string | null;
  permissions: string[];
  isPlatformAdmin: boolean;
  enabledModules: string[];
  /** Active company country (ISO alpha-2); absent on tokens issued before it existed. */
  countryCode?: string | null;
  exp: number;
}

export function decodeAccessToken(token: string): DecodedAccessToken {
  const payload = token.split(".")[1];
  const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(json);
}
