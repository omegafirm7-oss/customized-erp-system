export interface DecodedAccessToken {
  sub: string;
  email: string;
  activeCompanyId: string | null;
  roleId: string | null;
  permissions: string[];
  isPlatformAdmin: boolean;
  exp: number;
}

export function decodeAccessToken(token: string): DecodedAccessToken {
  const payload = token.split(".")[1];
  const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(json);
}
