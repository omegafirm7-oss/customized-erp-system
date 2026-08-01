import { ConflictException, Injectable } from "@nestjs/common";
import * as argon2 from "argon2";
import { randomBytes } from "crypto";
import { PrismaService } from "../common/prisma/prisma.service";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async createUser(email: string, password: string, fullName: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException("A user with this email already exists");
    }
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    return this.prisma.user.create({
      data: { email, passwordHash, fullName },
    });
  }

  /**
   * `passwordHash` is a required column (not nullable — every other code
   * path assumes it exists), so a Google-only account still gets one: a
   * random, unusable value nobody is ever told. They can only sign in via
   * Google unless they later set a real password some other way.
   */
  async createGoogleUser(googleId: string, email: string, fullName: string) {
    const passwordHash = await argon2.hash(randomBytes(32).toString("hex"), { type: argon2.argon2id });
    return this.prisma.user.create({
      data: { email, passwordHash, fullName, googleId },
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async verifyPassword(passwordHash: string, plainPassword: string): Promise<boolean> {
    return argon2.verify(passwordHash, plainPassword);
  }

  /**
   * Admin-initiated reset (no email infrastructure yet) — sets a new
   * password chosen by the admin and revokes the user's active refresh
   * tokens so any existing sessions must sign in again with it.
   */
  async adminResetPassword(userId: string, newPassword: string) {
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { reset: true };
  }
}
