export interface JwtPayload {
  sub: string;
  email: string;
  activeCompanyId: string | null;
  roleId: string | null;
  roleName: string | null;
  permissions: string[];
  isPlatformAdmin: boolean;
  enabledModules: string[];
}
