import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FbrEnvironment } from "@prisma/client";
import { FBR_ENDPOINTS, HS_CODE_REGEX, NTN_CNIC_REGEX, PK_PROVINCES, POS_SUCCESS_CODE } from "./fbr-constants";
import { DiInvoicePayload, DiItemStatus, DiResponse, FbrCallResult, PosInvoicePayload, PosResponse } from "./fbr.types";

/**
 * Transport for both FBR channels. SANDBOX/PRODUCTION hit the real PRAL
 * gateways with the company's bearer token; MOCK runs an in-process
 * imitation that enforces the DI v1.12 validation rules we rely on (so the
 * whole pipeline is testable before the client has FBR credentials) and
 * issues invoice numbers in FBR's format.
 *
 * Nothing here throws on FBR/HTTP errors — results are classified into
 * ACCEPTED / REJECTED / AUTH_FAILED / TRANSIENT_FAILURE, like ZatcaApiClient.
 */
@Injectable()
export class FbrApiClient {
  private readonly logger = new Logger(FbrApiClient.name);
  private readonly diTimeoutMs: number;
  private readonly posTimeoutMs: number;

  // ── Mock controls (tests / demo only) ──
  private mockOutagesRemaining = 0;
  private mockAuthFailuresRemaining = 0;
  private mockSequence = 0;

  constructor(configService: ConfigService) {
    this.diTimeoutMs = configService.get<number>("fbr.diTimeoutMs") ?? 30000;
    this.posTimeoutMs = configService.get<number>("fbr.posTimeoutMs") ?? 5000;
  }

  /** Make the next `count` MOCK calls fail as a network outage. */
  simulateOutage(count: number) {
    this.mockOutagesRemaining = count;
  }

  /** Make the next `count` MOCK calls fail with 401. */
  simulateAuthFailure(count: number) {
    this.mockAuthFailuresRemaining = count;
  }

  // ── Digital Invoicing ──────────────────────────────────────────────

  async validateDiInvoice(environment: FbrEnvironment, token: string | null, payload: DiInvoicePayload) {
    if (environment === FbrEnvironment.MOCK) return this.mockDi(payload, false);
    return this.callDi(FBR_ENDPOINTS.DI_VALIDATE[environment], token, payload, false);
  }

  async postDiInvoice(environment: FbrEnvironment, token: string | null, payload: DiInvoicePayload) {
    if (environment === FbrEnvironment.MOCK) return this.mockDi(payload, true);
    return this.callDi(FBR_ENDPOINTS.DI_POST[environment], token, payload, true);
  }

  /** GET a DI reference API (e.g. "/pdi/v1/provinces"); returns null on failure. */
  async getReference(environment: FbrEnvironment, token: string | null, path: string): Promise<unknown> {
    if (environment === FbrEnvironment.MOCK) {
      if (path.includes("provinces")) {
        return PK_PROVINCES.map((name, index) => ({ stateProvinceCode: index + 2, stateProvinceDesc: name }));
      }
      return [];
    }
    const res = await this.http("GET", `${FBR_ENDPOINTS.REFERENCE_BASE}${path}`, token, undefined, this.diTimeoutMs);
    return res.status === 200 ? res.body : null;
  }

  /**
   * Sales-tax registration status of an NTN/CNIC (DI reference API §5.12
   * Get_Reg_Type). The spec labels it GET but sends a JSON body, which
   * fetch cannot do — POST is what the gateway accepts from integrators;
   * confirm on the sandbox. MOCK: 7/9-digit NTNs are Registered, CNICs not.
   */
  async getRegistrationType(
    environment: FbrEnvironment,
    token: string | null,
    registrationNo: string,
  ): Promise<"Registered" | "Unregistered" | null> {
    if (environment === FbrEnvironment.MOCK) {
      return registrationNo.length === 13 ? "Unregistered" : "Registered";
    }
    const res = await this.http("POST", `${FBR_ENDPOINTS.REFERENCE_BASE}/dist/v1/Get_Reg_Type`, token, { Registration_No: registrationNo }, this.diTimeoutMs);
    const type = (res.body as { REGISTRATION_TYPE?: string } | null)?.REGISTRATION_TYPE;
    if (!type) return null;
    return type.toLowerCase() === "registered" ? "Registered" : "Unregistered";
  }

  // ── POS Integration (IMS) ──────────────────────────────────────────

  async postPosInvoice(
    environment: FbrEnvironment,
    token: string | null,
    payload: PosInvoicePayload,
  ): Promise<FbrCallResult<PosResponse>> {
    if (environment === FbrEnvironment.MOCK) return this.mockPos(payload);
    const res = await this.http("POST", FBR_ENDPOINTS.POS_POST[environment], token, payload, this.posTimeoutMs);
    const transport = this.classifyTransport<PosResponse>(res);
    if (transport) return transport;
    const body = res.body as PosResponse;
    if (body?.Code === POS_SUCCESS_CODE && body.InvoiceNumber) {
      return { outcome: "ACCEPTED", httpStatus: res.status, body, fbrInvoiceNumber: body.InvoiceNumber, errors: [] };
    }
    return {
      outcome: "REJECTED",
      httpStatus: res.status,
      body,
      fbrInvoiceNumber: null,
      errors: [{ code: body?.Code ?? "?", message: body?.Errors || body?.Response || "Rejected by FBR" }],
    };
  }

  // ── Real HTTP ──────────────────────────────────────────────────────

  private async callDi(url: string, token: string | null, payload: DiInvoicePayload, expectNumber: boolean) {
    const res = await this.http("POST", url, token, payload, this.diTimeoutMs);
    const transport = this.classifyTransport<DiResponse>(res);
    if (transport) return transport;
    return this.classifyDi(res.status!, res.body as DiResponse, expectNumber);
  }

  private classifyDi(httpStatus: number, body: DiResponse, expectNumber: boolean): FbrCallResult<DiResponse> {
    const vr = body?.validationResponse;
    const itemErrors = (vr?.invoiceStatuses ?? [])
      .filter((s) => s.statusCode !== "00")
      .map((s) => ({ code: s.errorCode, message: s.error, itemSNo: s.itemSNo }));
    const headerOk = vr?.statusCode === "00" && (vr.status ?? "").toLowerCase() === "valid";
    const accepted = headerOk && itemErrors.length === 0 && (!expectNumber || !!body.invoiceNumber);
    if (accepted) {
      return { outcome: "ACCEPTED", httpStatus, body, fbrInvoiceNumber: body.invoiceNumber ?? null, errors: [] };
    }
    const errors: Array<{ code: string; message: string; itemSNo?: string }> = [...itemErrors];
    if (vr?.error) errors.unshift({ code: vr.errorCode ?? vr.statusCode ?? "?", message: vr.error });
    if (errors.length === 0) errors.push({ code: vr?.statusCode ?? "?", message: "Rejected by FBR without a reason" });
    return { outcome: "REJECTED", httpStatus, body, fbrInvoiceNumber: null, errors };
  }

  private classifyTransport<T>(res: { status: number | null; body: unknown; error?: string }): FbrCallResult<T> | null {
    if (res.status === 401 || res.status === 403) {
      return {
        outcome: "AUTH_FAILED",
        httpStatus: res.status,
        body: null,
        fbrInvoiceNumber: null,
        errors: [{ code: String(res.status), message: "FBR rejected the security token (expired, wrong environment, or IP not whitelisted)" }],
      };
    }
    if (res.status === null || res.status >= 500) {
      return {
        outcome: "TRANSIENT_FAILURE",
        httpStatus: res.status,
        body: null,
        fbrInvoiceNumber: null,
        errors: [{ code: String(res.status ?? "NETWORK"), message: res.error ?? `FBR returned HTTP ${res.status}` }],
      };
    }
    return null;
  }

  private async http(
    method: "GET" | "POST",
    url: string,
    token: string | null,
    body: unknown,
    timeoutMs: number,
  ): Promise<{ status: number | null; body: unknown; error?: string }> {
    if (!token) return { status: 401, body: null };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = { raw: text.slice(0, 2000) };
      }
      return { status: response.status, body: parsed };
    } catch (error) {
      const message = error instanceof Error ? (error.name === "AbortError" ? `Timed out after ${timeoutMs}ms` : error.message) : String(error);
      this.logger.warn(`FBR ${method} ${url} failed: ${message}`);
      return { status: null, body: null, error: message };
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Mock ───────────────────────────────────────────────────────────

  private mockTransportFailure<T>(): FbrCallResult<T> | null {
    if (this.mockAuthFailuresRemaining > 0) {
      this.mockAuthFailuresRemaining--;
      return this.classifyTransport<T>({ status: 401, body: null });
    }
    if (this.mockOutagesRemaining > 0) {
      this.mockOutagesRemaining--;
      return this.classifyTransport<T>({ status: null, body: null, error: "Mock FBR outage" });
    }
    return null;
  }

  private mockDi(payload: DiInvoicePayload, issueNumber: boolean): FbrCallResult<DiResponse> {
    const failure = this.mockTransportFailure<DiResponse>();
    if (failure) return failure;
    const dated = new Date().toISOString().replace("T", " ").slice(0, 19);
    const headerError = (errorCode: string, error: string): FbrCallResult<DiResponse> =>
      this.classifyDi(200, { dated, validationResponse: { statusCode: "01", status: "Invalid", errorCode, error, invoiceStatuses: null } }, issueNumber);

    // Header rules (error codes from DI spec v1.12 §7 where known).
    if (!payload.sellerNTNCNIC || !NTN_CNIC_REGEX.test(payload.sellerNTNCNIC)) {
      return headerError("0001", "Seller not registered for sales tax, please provide valid registration/NTN.");
    }
    if (payload.buyerRegistrationType === "Registered" && !NTN_CNIC_REGEX.test(payload.buyerNTNCNIC)) {
      return headerError("0002", "Invalid Buyer Registration No or NTN");
    }
    if (payload.invoiceType !== "Sale Invoice" && payload.invoiceType !== "Debit Note") {
      return headerError("0003", "Provide proper invoice type.");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.invoiceDate)) {
      return headerError("0005", "please provide date in valid format");
    }
    if (!payload.buyerBusinessName) return headerError("0010", "Provide Buyer Name.");
    if (!(PK_PROVINCES as readonly string[]).includes(payload.sellerProvince.toUpperCase())) {
      return headerError("0073", "Provide valid seller province.");
    }
    if (!(PK_PROVINCES as readonly string[]).includes(payload.buyerProvince.toUpperCase())) {
      return headerError("0074", "Provide valid buyer province.");
    }
    if (payload.invoiceType === "Debit Note" && !payload.invoiceRefNo) {
      return headerError("0026", "Invoice Reference No. is required.");
    }
    const badHs = payload.items.findIndex((i) => !HS_CODE_REGEX.test(i.hsCode));
    if (badHs >= 0) return headerError("0052", `Provide proper HS Code with invoice no. ${badHs + 1}`);

    // Item rules.
    const statuses: DiItemStatus[] = payload.items.map((item, index) => {
      const fail = (errorCode: string, error: string): DiItemStatus => ({
        itemSNo: String(index + 1), statusCode: "01", status: "Invalid", invoiceNo: null, errorCode, error,
      });
      if (!item.rate) return fail("0046", "Provide rate.");
      if (!item.saleType) return fail("0013", "Provide valid Sale type.");
      if (!(item.quantity > 0)) return fail("0021", "Please provide Value of Sales Excl. ST /Quantity");
      if (item.saleType === "3rd Schedule Goods") {
        const expected = round2(item.fixedNotifiedValueOrRetailPrice * parseRate(item.rate));
        if (!(item.fixedNotifiedValueOrRetailPrice > 0)) return fail("0090", "Please provide Fixed / notified value or Retail Price");
        if (Math.abs(expected - item.salesTaxApplicable) > 1) return fail("0111", "Calculated tax not matched in 3rd schedule");
      } else if (item.rate !== "Exempt") {
        const expected = round2(item.valueSalesExcludingST * parseRate(item.rate));
        if (Math.abs(expected - item.salesTaxApplicable) > 1) {
          return fail("0102", `Sales tax ${item.salesTaxApplicable} does not match rate ${item.rate} on ${item.valueSalesExcludingST}`);
        }
      }
      return { itemSNo: String(index + 1), statusCode: "00", status: "Valid", invoiceNo: null, errorCode: "", error: "" };
    });
    const allValid = statuses.every((s) => s.statusCode === "00");
    const invoiceNumber = allValid && issueNumber ? `${payload.sellerNTNCNIC}DI${Date.now()}${this.mockSequence++ % 10}` : undefined;
    if (invoiceNumber) statuses.forEach((s, i) => (s.invoiceNo = `${invoiceNumber}-${i + 1}`));
    return this.classifyDi(
      200,
      {
        invoiceNumber,
        dated,
        validationResponse: { statusCode: "00", status: allValid ? "Valid" : "invalid", error: "", invoiceStatuses: statuses },
      },
      issueNumber,
    );
  }

  private mockPos(payload: PosInvoicePayload): FbrCallResult<PosResponse> {
    const failure = this.mockTransportFailure<PosResponse>();
    if (failure) return failure;
    const reject = (message: string): FbrCallResult<PosResponse> => ({
      outcome: "REJECTED",
      httpStatus: 200,
      body: { InvoiceNumber: null, Code: "102", Response: "Invalid invoice data", Errors: message },
      fbrInvoiceNumber: null,
      errors: [{ code: "102", message }],
    });
    if (!(payload.POSID > 0)) return reject("POSID is not registered");
    if (!payload.USIN) return reject("USIN is required");
    if (payload.Items.length === 0) return reject("At least one item is required");
    if (payload.Items.some((i) => !/^\d{8}$/.test(i.PCTCode))) return reject("Invalid PCTCode");
    if (payload.InvoiceType === 3 && !payload.RefUSIN) return reject("RefUSIN is required for credit invoices");
    const invoiceNumber = `${payload.POSID}${formatCompactStamp(new Date())}${String(this.mockSequence++ % 1000).padStart(3, "0")}`;
    return {
      outcome: "ACCEPTED",
      httpStatus: 200,
      body: { InvoiceNumber: invoiceNumber, Code: POS_SUCCESS_CODE, Response: "Fiscal Invoice Number generated successfully.", Errors: null },
      fbrInvoiceNumber: invoiceNumber,
      errors: [],
    };
  }
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function parseRate(rate: string): number {
  const n = parseFloat(rate);
  return Number.isFinite(n) ? n / 100 : 0;
}

function formatCompactStamp(date: Date) {
  return date.toISOString().replace(/[-:TZ.]/g, "").slice(2, 14);
}
