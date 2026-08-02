export interface AppConfig {
  databaseUrl: string;
  jwt: {
    accessSecret: string;
    accessTtl: string;
    refreshSecret: string;
    refreshTtl: string;
  };
  google: {
    clientId: string;
    clientSecret: string;
    callbackUrl: string;
  };
  mail: {
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    smtpPass: string;
    fromAddress: string;
    /** Origin the reset link points at, e.g. https://universa.omegaprofessionals.com */
    appUrl: string;
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
  google: {
    // Placeholders until the real Client ID/Secret are set — passport's
    // OAuth2Strategy throws synchronously at construction time (i.e. app
    // boot) if clientID/clientSecret are falsy, so these can't be empty
    // strings. With placeholders the app boots fine and the strategy
    // registers; a real login attempt just fails against Google
    // (invalid_client) until real credentials are provided as env vars.
    clientId: process.env.GOOGLE_CLIENT_ID ?? "not-configured",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "not-configured",
    callbackUrl: process.env.GOOGLE_CALLBACK_URL ?? "http://localhost:3000/auth/google/callback",
  },
  mail: {
    // Empty host = SMTP not configured yet — MailService skips the actual
    // send (logs a warning) instead of throwing, same "inert until real
    // credentials arrive" pattern as the Google strategy above.
    smtpHost: process.env.SMTP_HOST ?? "",
    smtpPort: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587,
    smtpUser: process.env.SMTP_USER ?? "",
    smtpPass: process.env.SMTP_PASS ?? "",
    fromAddress: process.env.MAIL_FROM ?? "Universa Centrix <no-reply@universa.omegaprofessionals.com>",
    appUrl: process.env.APP_URL ?? "http://localhost:5173",
  },
  zatca: {
    encryptionKey: process.env.ZATCA_KEY_ENCRYPTION_KEY ?? "",
    host: process.env.ZATCA_HOST ?? "https://gw-fatoora.zatca.gov.sa/e-invoicing",
    timeoutMs: process.env.ZATCA_TIMEOUT_MS ? Number(process.env.ZATCA_TIMEOUT_MS) : 30000,
  },
  port: process.env.PORT ? Number(process.env.PORT) : 3000,
});
