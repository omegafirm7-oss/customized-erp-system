import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { AuditAction } from "@prisma/client";
import { randomBytes, randomUUID, createHash } from "crypto";
import ms from "ms";
import { IDLE_TIMEOUT_MS, IDLE_WARNING_MS } from "@erp/shared-constants";
import { PrismaService } from "../common/prisma/prisma.service";
import { MailService } from "../common/mail/mail.service";
import { IamService } from "../iam/iam.service";
import { UsersService } from "../iam/users.service";
import { AuditService } from "../audit/audit.service";
import { JwtPayload } from "./types/jwt-payload.type";
import { AppConfig } from "../core/config/configuration";

// Mirrors the frontend's IdleTimeoutGuard countdown (3min idle + 2min
// warning) — a session with no activity heartbeat in this long is revoked
// server-side regardless of whether the client-side timer actually fired.
const IDLE_SESSION_TOTAL_MS = IDLE_TIMEOUT_MS + IDLE_WARNING_MS;

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly iamService: IamService,
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
    private readonly auditService: AuditService,
  ) {}

  async register(email: string, password: string, fullName: string) {
    return this.usersService.createUser(email, password, fullName);
  }

  /**
   * Finds the user behind a Google account, linking by email if they
   * already registered with a password (so they can use either method
   * afterward), or creating a brand-new account if this is their first
   * time — mirrors plain register() otherwise (no company yet; they land
   * on /companies to create/join one just like a fresh email signup).
   */
  async findOrCreateGoogleUser(googleId: string, email: string, fullName: string) {
    const byGoogleId = await this.prisma.user.findUnique({ where: { googleId } });
    if (byGoogleId) {
      return byGoogleId;
    }
    const byEmail = await this.usersService.findByEmail(email);
    if (byEmail) {
      return this.prisma.user.update({ where: { id: byEmail.id }, data: { googleId } });
    }
    return this.usersService.createGoogleUser(googleId, email, fullName);
  }

  async validateUserCredentials(email: string, password: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user || !user.isActive) {
      return null;
    }
    const valid = await this.usersService.verifyPassword(user.passwordHash, password);
    return valid ? user : null;
  }

  async login(userId: string, meta: RequestMeta = {}): Promise<IssuedTokens> {
    const memberships = await this.iamService.getCompanyMemberships(userId);
    const activeMemberships = memberships.filter((m) => m.status === "ACTIVE");
    // A user whose every company membership has been suspended (or who was
    // never added to any company) has nowhere to land — reject the login
    // outright rather than issuing a token with an empty permission set.
    if (memberships.length > 0 && activeMemberships.length === 0) {
      throw new UnauthorizedException("Your access has been suspended — contact your company administrator");
    }
    const defaultMembership = activeMemberships.find((m) => m.isDefault) ?? activeMemberships[0] ?? null;
    const companyId = defaultMembership?.companyId ?? null;
    const tokens = await this.issueTokens(userId, companyId, meta);
    void this.auditService.log({
      companyId,
      entityName: "User",
      entityId: userId,
      action: AuditAction.LOGIN,
      changedByUserId: userId,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
    });
    return tokens;
  }

  async switchCompany(userId: string, companyId: string, meta: RequestMeta = {}): Promise<IssuedTokens> {
    const membership = await this.prisma.companyUser.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!membership || membership.status !== "ACTIVE") {
      throw new ForbiddenException("You are not an active member of this company");
    }
    return this.issueTokens(userId, companyId, meta);
  }

  async refresh(rawToken: string, meta: RequestMeta = {}): Promise<IssuedTokens> {
    const [id, secret] = rawToken.split(".");
    if (!id || !secret) {
      throw new UnauthorizedException("Malformed refresh token");
    }

    const existing = await this.prisma.refreshToken.findUnique({ where: { id } });
    if (!existing) {
      throw new UnauthorizedException("Refresh token not recognized");
    }

    if (existing.revokedAt) {
      // Reuse of an already-rotated/revoked token is a compromise signal —
      // revoke the entire token family (all tokens for this user) to force re-login.
      await this.prisma.refreshToken.updateMany({
        where: { userId: existing.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException("Refresh token reuse detected — all sessions revoked");
    }

    if (existing.expiresAt < new Date() || this.hashSecret(secret) !== existing.tokenHash) {
      throw new UnauthorizedException("Refresh token invalid or expired");
    }

    // Server-side idle enforcement: a session with no activity heartbeat
    // (see touchActivity, called from POST /auth/heartbeat) for longer than
    // the idle+warning window is dead regardless of what the client-side
    // timer thinks — this is what makes opening a fresh tab after being
    // away not silently grant another full idle window.
    if (Date.now() - existing.lastActivityAt.getTime() > IDLE_SESSION_TOTAL_MS) {
      await this.prisma.refreshToken.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException("Session expired due to inactivity");
    }

    // Re-check access on every refresh, not just at the original login — a
    // user deactivated or a company membership suspended after a token was
    // issued must not be able to keep minting fresh access tokens with it.
    const user = await this.prisma.user.findUnique({ where: { id: existing.userId } });
    if (!user || !user.isActive) {
      await this.prisma.refreshToken.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException("Account is no longer active");
    }
    if (existing.activeCompanyId) {
      const membership = await this.prisma.companyUser.findUnique({
        where: { userId_companyId: { userId: existing.userId, companyId: existing.activeCompanyId } },
      });
      if (!membership || membership.status !== "ACTIVE") {
        await this.prisma.refreshToken.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
        throw new UnauthorizedException("Access to this company has been revoked");
      }
    }

    const tokens = await this.issueTokens(existing.userId, existing.activeCompanyId, meta);
    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
    return tokens;
  }

  async revoke(rawToken: string, meta: RequestMeta = {}): Promise<void> {
    const [id] = rawToken.split(".");
    if (!id) return;
    const existing = await this.prisma.refreshToken.findUnique({ where: { id } });
    await this.prisma.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (existing && !existing.revokedAt) {
      void this.auditService.log({
        companyId: existing.activeCompanyId,
        entityName: "User",
        entityId: existing.userId,
        action: AuditAction.LOGOUT,
        changedByUserId: existing.userId,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
      });
    }
  }

  /**
   * Called by POST /auth/heartbeat, throttled client-side, whenever the
   * frontend observes real user activity (mouse/keyboard/scroll) — the only
   * server-side signal of "the user is actually here" that exists, since
   * access-token validation is pure local JWT verification with no DB
   * round-trip. If the session was already stale past the idle+warning
   * window (e.g. the tab was suspended and stopped sending heartbeats, or
   * a stray request arrives just after the deadline), revoke it instead of
   * reviving it — a heartbeat is evidence of activity now, not proof there
   * wasn't a gap long enough to have already timed the session out.
   */
  async touchActivity(rawToken: string): Promise<void> {
    const [id, secret] = rawToken.split(".");
    if (!id || !secret) {
      throw new UnauthorizedException("Malformed refresh token");
    }
    const existing = await this.prisma.refreshToken.findUnique({ where: { id } });
    if (!existing || existing.revokedAt || existing.expiresAt < new Date() || this.hashSecret(secret) !== existing.tokenHash) {
      throw new UnauthorizedException("Refresh token invalid or expired");
    }
    if (Date.now() - existing.lastActivityAt.getTime() > IDLE_SESSION_TOTAL_MS) {
      await this.prisma.refreshToken.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException("Session expired due to inactivity");
    }
    await this.prisma.refreshToken.update({ where: { id: existing.id }, data: { lastActivityAt: new Date() } });
  }

  private async issueTokens(
    userId: string,
    activeCompanyId: string | null,
    meta: RequestMeta,
  ): Promise<IssuedTokens> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    let roleId: string | null = null;
    let roleName: string | null = null;
    let permissions: string[] = [];
    let enabledModules: string[] = [];
    if (activeCompanyId) {
      const [membership, company] = await Promise.all([
        this.prisma.companyUser.findUnique({
          where: { userId_companyId: { userId, companyId: activeCompanyId } },
          include: { role: { select: { name: true } } },
        }),
        this.prisma.company.findUnique({
          where: { id: activeCompanyId },
          select: { enabledModules: true },
        }),
      ]);
      roleId = membership?.roleId ?? null;
      roleName = membership?.role?.name ?? null;
      permissions = await this.iamService.getPermissionsForCompanyUser(userId, activeCompanyId);
      enabledModules = company?.enabledModules ?? [];
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      activeCompanyId,
      roleId,
      roleName,
      permissions,
      isPlatformAdmin: user.isPlatformAdmin,
      enabledModules,
    };

    const jwtConfig = this.configService.get("jwt", { infer: true });
    const accessToken = this.jwtService.sign(payload, {
      secret: jwtConfig.accessSecret,
      expiresIn: jwtConfig.accessTtl,
    });
    const expiresIn = Math.floor(ms(jwtConfig.accessTtl) / 1000);

    const refreshSecret = randomBytes(32).toString("hex");
    const refreshId = randomUUID();
    const refreshExpiresAt = new Date(Date.now() + ms(jwtConfig.refreshTtl));

    await this.prisma.refreshToken.create({
      data: {
        id: refreshId,
        userId: user.id,
        tokenHash: this.hashSecret(refreshSecret),
        activeCompanyId,
        expiresAt: refreshExpiresAt,
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
      },
    });

    return {
      accessToken,
      expiresIn,
      refreshToken: `${refreshId}.${refreshSecret}`,
      refreshExpiresAt,
    };
  }

  /**
   * Always resolves the same way regardless of whether the email is
   * registered — the caller-facing response must never reveal which emails
   * exist (a standard anti-enumeration measure). Only sends an email, and
   * only creates a token, when a matching active user is actually found.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    if (!user || !user.isActive) {
      return;
    }
    const rawToken = randomBytes(32).toString("hex");
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashSecret(rawToken),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
    const appUrl = this.configService.get("mail", { infer: true }).appUrl;
    const resetUrl = `${appUrl}/reset-password?token=${rawToken}`;
    await this.mailService.sendPasswordResetEmail(user.email, resetUrl);
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = this.hashSecret(rawToken);
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException("This reset link is invalid or has expired — request a new one");
    }
    await this.usersService.adminResetPassword(record.userId, newPassword);
    await this.prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
  }

  private hashSecret(secret: string): string {
    return createHash("sha256").update(secret).digest("hex");
  }
}
