import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/common/prisma/prisma.service";

export interface ProviderOverride {
  provide: unknown;
  useValue: unknown;
}

export async function createTestApp(overrides: ProviderOverride[] = []): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  for (const override of overrides) {
    builder = builder.overrideProvider(override.provide).useValue(override.useValue);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  return app;
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}@test.local`;
}

export function uniqueCode(prefix: string): string {
  return `${prefix}${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 100)}`;
}

/**
 * Registers a fresh user, logs in, and creates a fresh company (auto-provisioned
 * with cloned COA, fiscal year/periods, and the JOURNAL_ENTRY numbering series).
 * Returns everything a test typically needs to drive the GL end to end.
 */
export async function setupUserWithCompany(app: INestApplication) {
  const email = uniqueEmail("gluser");
  const password = "SuperSecret123!";

  await request(app.getHttpServer()).post("/auth/register").send({ email, password, fullName: "Test User" }).expect(201);

  const loginRes = await request(app.getHttpServer()).post("/auth/login").send({ email, password }).expect(201);
  const registerAccessToken: string = loginRes.body.accessToken;

  const companyRes = await request(app.getHttpServer())
    .post("/companies")
    .set("Authorization", `Bearer ${registerAccessToken}`)
    .send({
      code: uniqueCode("CO"),
      legalName: "Test Company Ltd",
      countryCode: "SA",
      baseCurrency: "SAR",
    })
    .expect(201);

  const companyId: string = companyRes.body.id;

  // The first access token was issued before the company (and the
  // CompanyUser membership) existed, so it carries no activeCompanyId.
  // Re-login to get a token scoped to the newly created (and now default) company.
  const rescopedLogin = await request(app.getHttpServer()).post("/auth/login").send({ email, password }).expect(201);
  const accessToken: string = rescopedLogin.body.accessToken;

  const accountsRes = await request(app.getHttpServer())
    .get("/coa/accounts")
    .set("Authorization", `Bearer ${accessToken}`)
    .expect(200);

  const cashAccount = accountsRes.body.find((a: any) => a.code === "1110");
  const equityAccount = accountsRes.body.find((a: any) => a.code === "3100");
  const accountByCode = (code: string) => accountsRes.body.find((a: any) => a.code === code);

  return { email, password, accessToken, companyId, cashAccount, equityAccount, accountByCode, accounts: accountsRes.body };
}

/**
 * Grants premium module entitlements directly (bypassing the platform-admin
 * HTTP route, since these are ordinary test companies) and re-logs-in to get
 * a fresh access token carrying the updated Company.enabledModules — JWTs
 * only pick up entitlement changes at issuance time (login/refresh), never
 * mid-token.
 */
export async function grantModules(
  app: INestApplication,
  ctx: { email: string; password: string; companyId: string },
  modules: string[],
): Promise<string> {
  const prisma = getPrisma(app);
  await prisma.company.update({ where: { id: ctx.companyId }, data: { enabledModules: modules } });
  const relogin = await request(app.getHttpServer())
    .post("/auth/login")
    .send({ email: ctx.email, password: ctx.password })
    .expect(201);
  return relogin.body.accessToken;
}

export async function createPartner(
  app: INestApplication,
  accessToken: string,
  partnerType: "CUSTOMER" | "VENDOR" | "BOTH",
  overrides: Record<string, unknown> = {},
) {
  const res = await request(app.getHttpServer())
    .post("/partners")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({
      code: uniqueCode("BP"),
      name: partnerType === "VENDOR" ? "Test Vendor LLC" : "Test Customer LLC",
      partnerType,
      taxRegistrationNumber: "300000000000003",
      ...overrides,
    })
    .expect(201);
  return res.body;
}

/**
 * A minimal AR/AP-ready service item: no UoM catalog needed (creates one),
 * revenue account 4100 and expense account 5240 defaulted from the standard
 * template COA.
 */
export async function createItem(
  app: INestApplication,
  accessToken: string,
  defaults: {
    defaultSalesAccountId?: string;
    defaultPurchaseAccountId?: string;
    vatCategory?: string;
    itemType?: "SERVICE" | "INVENTORY" | "NON_INVENTORY";
    isInventoryItem?: boolean;
  } = {},
) {
  const uomRes = await request(app.getHttpServer())
    .post("/uoms")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ code: uniqueCode("EA"), name: "Each" })
    .expect(201);

  const res = await request(app.getHttpServer())
    .post("/items")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({
      code: uniqueCode("ITM"),
      name: defaults.isInventoryItem ? "Test Stock Item" : "Test Service Item",
      itemType: defaults.itemType ?? "SERVICE",
      baseUoMId: uomRes.body.id,
      vatCategory: defaults.vatCategory ?? "STANDARD_15",
      ...(defaults.isInventoryItem !== undefined ? { isInventoryItem: defaults.isInventoryItem } : {}),
      ...(defaults.defaultSalesAccountId ? { defaultSalesAccountId: defaults.defaultSalesAccountId } : {}),
      ...(defaults.defaultPurchaseAccountId ? { defaultPurchaseAccountId: defaults.defaultPurchaseAccountId } : {}),
    })
    .expect(201);
  return res.body;
}

/** Creates an additional warehouse in the current company. */
export async function createWarehouse(app: INestApplication, accessToken: string, code?: string) {
  const res = await request(app.getHttpServer())
    .post("/warehouses")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ code: code ?? uniqueCode("WH"), name: "Extra Warehouse" })
    .expect(201);
  return res.body;
}

export function getPrisma(app: INestApplication): PrismaService {
  return app.get(PrismaService);
}
