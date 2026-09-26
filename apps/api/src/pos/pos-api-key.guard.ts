import { CanActivate, ExecutionContext, ForbiddenException, HttpException, HttpStatus, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash } from "crypto";
import { MODULE_KEYS } from "@erp/shared-constants";
import { PrismaService } from "../common/prisma/prisma.service";

export const POS_KEY_HEADER = "x-pos-key";

/** sha256 hex of a terminal API key — the only form ever stored. */
export function hashPosKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

const RATE_LIMIT_PER_MINUTE = 120;

/**
 * Machine-to-machine auth for the inbound POS API (routes are @Public() to
 * skip the JWT guard). Resolves the terminal from the X-POS-Key header and
 * pins request.companyId / request.posTerminal — the company always comes
 * from the key, never from the request body. Also enforces the company's
 * FBR entitlement and a simple per-terminal rate limit.
 */
@Injectable()
export class PosApiKeyGuard implements CanActivate {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const key = request.headers?.[POS_KEY_HEADER];
    if (typeof key !== "string" || key.length < 20) {
      throw new UnauthorizedException("Missing or malformed X-POS-Key header");
    }
    const terminal = await this.prisma.posTerminal.findUnique({
      where: { apiKeyHash: hashPosKey(key) },
      include: { company: { select: { id: true, countryCode: true, enabledModules: true, isActive: true } } },
    });
    if (!terminal || !terminal.isActive || !terminal.company.isActive) {
      throw new UnauthorizedException("Unknown or revoked POS key");
    }
    if (!terminal.company.enabledModules.includes(MODULE_KEYS.FBR)) {
      throw new ForbiddenException(`This company is not entitled to the "${MODULE_KEYS.FBR}" module`);
    }

    const now = Date.now();
    const window = this.windows.get(terminal.id);
    if (!window || now - window.start > 60_000) {
      this.windows.set(terminal.id, { start: now, count: 1 });
    } else if (++window.count > RATE_LIMIT_PER_MINUTE) {
      throw new HttpException("Too many requests from this terminal", HttpStatus.TOO_MANY_REQUESTS);
    }

    request.posTerminal = terminal;
    request.companyId = terminal.companyId;
    request.userId = terminal.createdByUserId;
    void this.prisma.posTerminal.update({ where: { id: terminal.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    return true;
  }
}
