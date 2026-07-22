export interface AppConfig {
  databaseUrl: string;
  jwt: {
    accessSecret: string;
    accessTtl: string;
    refreshSecret: string;
    refreshTtl: string;
  };
  zatca: {
    /** 32-byte key (base64 or hex) for AES-256-GCM encryption of device
     * private keys and CSID secrets at rest. */
    encryptionKey: string;
    host: string;
    timeoutMs: number;
  };
  port: number;
}

export default (): AppConfig => ({
  databaseUrl: process.env.DATABASE_URL ?? "",
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? "dev-access-secret",
    accessTtl: process.env.JWT_ACCESS_TTL ?? "15m",
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? "dev-refresh-secret",
    refreshTtl: process.env.JWT_REFRESH_TTL ?? "30d",
  },
  zatca: {
    encryptionKey: process.env.ZATCA_KEY_ENCRYPTION_KEY ?? "",
    host: process.env.ZATCA_HOST ?? "https://gw-fatoora.zatca.gov.sa/e-invoicing",
    timeoutMs: process.env.ZATCA_TIMEOUT_MS ? Number(process.env.ZATCA_TIMEOUT_MS) : 30000,
  },
  port: process.env.PORT ? Number(process.env.PORT) : 3000,
});
