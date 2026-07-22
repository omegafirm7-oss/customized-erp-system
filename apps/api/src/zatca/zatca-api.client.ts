import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ZatcaEnvironment } from "@prisma/client";

/**
 * Thin typed client for the ZATCA Fatoora APIs. All methods classify the
 * outcome rather than throwing on HTTP errors, so callers can drive the
 * submission state machine without try/catch pyramids:
 *  - ACCEPTED (200) / ACCEPTED_WITH_WARNINGS (202): document accepted
 *  - REJECTED (400): validation failure — terminal for that document
 *  - AUTH_FAILED (401/403): credentials problem — device-level issue
 *  - TRANSIENT_FAILURE (5xx, network, timeout): retryable
 */

export type ZatcaOutcome = "ACCEPTED" | "ACCEPTED_WITH_WARNINGS" | "REJECTED" | "AUTH_FAILED" | "TRANSIENT_FAILURE";

export interface ZatcaApiResult {
  outcome: ZatcaOutcome;
  httpStatus: number | null;
  body: Record<string, unknown> | null;
  errorMessage?: string;
}

export interface CsidCredentials {
  binarySecurityToken: string;
  secret: string;
}

const BASE_PATH_BY_ENV: Record<ZatcaEnvironment, string> = {
  SANDBOX: "developer-portal",
  SIMULATION: "simulation",
  PRODUCTION: "core",
};

@Injectable()
export class ZatcaApiClient {
  private readonly logger = new Logger(ZatcaApiClient.name);
  private readonly host: string;
  private readonly timeoutMs: number;

  constructor(configService: ConfigService) {
    this.host = configService.get<string>("zatca.host") ?? "https://gw-fatoora.zatca.gov.sa/e-invoicing";
    this.timeoutMs = configService.get<number>("zatca.timeoutMs") ?? 30000;
  }

  private baseUrl(environment: ZatcaEnvironment): string {
    return `${this.host}/${BASE_PATH_BY_ENV[environment]}`;
  }

  private basicAuth(credentials: CsidCredentials): string {
    return "Basic " + Buffer.from(`${credentials.binarySecurityToken}:${credentials.secret}`).toString("base64");
  }

  private async request(
    url: string,
    headers: Record<string, string>,
    body: Record<string, unknown>,
  ): Promise<ZatcaApiResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Version": "V2",
          ...headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      let responseBody: Record<string, unknown> | null = null;
      try {
        responseBody = (await response.json()) as Record<string, unknown>;
      } catch {
        responseBody = null;
      }

      let outcome: ZatcaOutcome;
      if (response.status === 200) outcome = "ACCEPTED";
      else if (response.status === 202) outcome = "ACCEPTED_WITH_WARNINGS";
      else if (response.status === 400) outcome = "REJECTED";
      else if (response.status === 401 || response.status === 403) outcome = "AUTH_FAILED";
      else outcome = "TRANSIENT_FAILURE";

      return { outcome, httpStatus: response.status, body: responseBody };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`ZATCA request to ${url} failed: ${message}`);
      return { outcome: "TRANSIENT_FAILURE", httpStatus: null, body: null, errorMessage: message };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Compliance CSID: authenticated only by the OTP header. */
  async requestComplianceCsid(environment: ZatcaEnvironment, csrBase64: string, otp: string): Promise<ZatcaApiResult> {
    return this.request(`${this.baseUrl(environment)}/compliance`, { OTP: otp }, { csr: csrBase64 });
  }

  /** Compliance invoice check (the six onboarding samples). */
  async complianceCheck(
    environment: ZatcaEnvironment,
    credentials: CsidCredentials,
    payload: { invoiceHash: string; uuid: string; invoice: string },
  ): Promise<ZatcaApiResult> {
    return this.request(
      `${this.baseUrl(environment)}/compliance/invoices`,
      { Authorization: this.basicAuth(credentials) },
      payload,
    );
  }

  /** Production CSID, authenticated with the compliance CSID. */
  async requestProductionCsid(
    environment: ZatcaEnvironment,
    credentials: CsidCredentials,
    complianceRequestId: string,
  ): Promise<ZatcaApiResult> {
    return this.request(
      `${this.baseUrl(environment)}/production/csids`,
      { Authorization: this.basicAuth(credentials) },
      { compliance_request_id: complianceRequestId },
    );
  }

  /** Real-time clearance for standard (B2B) invoices. */
  async clearInvoice(
    environment: ZatcaEnvironment,
    credentials: CsidCredentials,
    payload: { invoiceHash: string; uuid: string; invoice: string },
  ): Promise<ZatcaApiResult> {
    return this.request(
      `${this.baseUrl(environment)}/invoices/clearance/single`,
      { Authorization: this.basicAuth(credentials), "Clearance-Status": "1" },
      payload,
    );
  }

  /** Reporting for simplified (B2C) invoices. */
  async reportInvoice(
    environment: ZatcaEnvironment,
    credentials: CsidCredentials,
    payload: { invoiceHash: string; uuid: string; invoice: string },
  ): Promise<ZatcaApiResult> {
    return this.request(
      `${this.baseUrl(environment)}/invoices/reporting/single`,
      { Authorization: this.basicAuth(credentials) },
      payload,
    );
  }
}
