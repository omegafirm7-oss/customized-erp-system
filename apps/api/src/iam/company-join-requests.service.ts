import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";

@Injectable()
export class CompanyJoinRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Self-service: a user requests to join a company by its code (not a
   * public directory — the requester must already know the code, mirroring
   * how "create a company" surfaces `code` as the company's primary
   * human-facing identifier). Blocks duplicate PENDING requests and
   * requests from users already active in the company; a REJECTED request
   * does not block requesting again.
   */
  async create(userId: string, companyCode: string, message?: string) {
    const company = await this.prisma.company.findUnique({ where: { code: companyCode } });
    if (!company) {
      throw new NotFoundException("No company found with that code");
    }

    const existingMembership = await this.prisma.companyUser.findUnique({
      where: { userId_companyId: { userId, companyId: company.id } },
    });
    if (existingMembership) {
      throw new ConflictException("You are already a member of this company");
    }

    const existingPending = await this.prisma.companyJoinRequest.findFirst({
      where: { userId, companyId: company.id, status: "PENDING" },
    });
    if (existingPending) {
      throw new ConflictException("You already have a pending request to join this company");
    }

    return this.prisma.companyJoinRequest.create({
      data: { userId, companyId: company.id, message },
    });
  }

  async listPendingForCompany(companyId: string) {
    const requests = await this.prisma.companyJoinRequest.findMany({
      where: { companyId, status: "PENDING" },
      include: { user: { select: { id: true, email: true, fullName: true } } },
      orderBy: { requestedAt: "asc" },
    });
    return requests.map((r) => ({
      id: r.id,
      userId: r.user.id,
      email: r.user.email,
      fullName: r.user.fullName,
      message: r.message,
      requestedAt: r.requestedAt,
    }));
  }

  async listMineForUser(userId: string) {
    const requests = await this.prisma.companyJoinRequest.findMany({
      where: { userId },
      include: { company: { select: { code: true, legalName: true } } },
      orderBy: { requestedAt: "desc" },
    });
    return requests.map((r) => ({
      id: r.id,
      companyCode: r.company.code,
      companyName: r.company.legalName,
      status: r.status,
      requestedAt: r.requestedAt,
      decidedAt: r.decidedAt,
    }));
  }

  private async getPendingRequestOrThrow(companyId: string, requestId: string) {
    const request = await this.prisma.companyJoinRequest.findFirst({
      where: { id: requestId, companyId },
    });
    if (!request) {
      throw new NotFoundException("Join request not found");
    }
    if (request.status !== "PENDING") {
      throw new ConflictException("This join request has already been decided");
    }
    return request;
  }

  /** Mirrors companies.service.ts's own CompanyUser creation shape exactly (isDefault, joinedAt). */
  async approve(companyId: string, requestId: string, roleId: string, decidedByUserId: string) {
    const request = await this.getPendingRequestOrThrow(companyId, requestId);

    const role = await this.prisma.role.findFirst({ where: { id: roleId, companyId } });
    if (!role) {
      throw new NotFoundException("Role not found for this company");
    }

    return this.prisma.$transaction(async (tx) => {
      const existingMemberships = await tx.companyUser.count({ where: { userId: request.userId } });
      await tx.companyUser.create({
        data: {
          userId: request.userId,
          companyId,
          roleId,
          isDefault: existingMemberships === 0,
          joinedAt: new Date(),
        },
      });
      return tx.companyJoinRequest.update({
        where: { id: request.id },
        data: { status: "APPROVED", roleId, decidedByUserId, decidedAt: new Date() },
      });
    });
  }

  async reject(companyId: string, requestId: string, decidedByUserId: string) {
    const request = await this.getPendingRequestOrThrow(companyId, requestId);
    return this.prisma.companyJoinRequest.update({
      where: { id: request.id },
      data: { status: "REJECTED", decidedByUserId, decidedAt: new Date() },
    });
  }
}
