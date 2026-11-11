import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ChatChannelKind } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const PAGE_SIZE = 50;
// Anything that can run on a recipient's machine is refused outright; everything else is shared as an opaque download.
const BLOCKED_EXTENSIONS = new Set([
  "exe", "bat", "cmd", "com", "msi", "scr", "ps1", "vbs", "vbe", "js", "jse", "jar", "sh", "app", "apk", "dll", "lnk", "reg", "hta", "wsf",
]);

export interface ChatFileInput {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  // ── people ──────────────────────────────────────────────────────────

  /** Everyone who can be chatted with: the active members of the company. */
  async listPeople(companyId: string) {
    const members = await this.prisma.companyUser.findMany({
      where: { companyId, status: "ACTIVE" },
      select: { user: { select: { id: true, fullName: true, email: true } } },
    });
    return members
      .map((m) => ({ id: m.user.id, name: m.user.fullName, email: m.user.email }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async nameMap(userIds: string[]) {
    const users = userIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: [...new Set(userIds)] } }, select: { id: true, fullName: true, email: true } })
      : [];
    return new Map(users.map((u) => [u.id, u.fullName || u.email]));
  }

  private async assertCompanyMembers(companyId: string, userIds: string[]) {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return;
    const found = await this.prisma.companyUser.count({ where: { companyId, status: "ACTIVE", userId: { in: ids } } });
    if (found !== ids.length) {
      throw new BadRequestException("Everyone you add must be an active member of this company");
    }
  }

  // ── channels ────────────────────────────────────────────────────────

  /** Makes sure the company has its default #general channel (every company gets chat, always on). */
  private async ensureGeneral(companyId: string, userId: string) {
    const existing = await this.prisma.chatChannel.count({ where: { companyId, kind: ChatChannelKind.CHANNEL } });
    if (existing > 0) return;
    try {
      const people = await this.prisma.companyUser.findMany({ where: { companyId, status: "ACTIVE" }, select: { userId: true } });
      await this.prisma.chatChannel.create({
        data: {
          companyId,
          kind: ChatChannelKind.CHANNEL,
          name: "general",
          isPrivate: false,
          createdByUserId: userId,
          members: { create: people.map((p) => ({ userId: p.userId })) },
        },
      });
    } catch (err: any) {
      if (err?.code !== "P2002") throw err; // another request created it first
    }
  }

  /** Public channels are open to the whole company, so a member row is created the first time someone sees one. */
  private async ensurePublicMemberships(companyId: string, userId: string) {
    const missing = await this.prisma.chatChannel.findMany({
      where: { companyId, kind: ChatChannelKind.CHANNEL, isPrivate: false, members: { none: { userId } } },
      select: { id: true },
    });
    if (missing.length > 0) {
      await this.prisma.chatMember.createMany({ data: missing.map((c) => ({ channelId: c.id, userId })), skipDuplicates: true });
    }
  }

  async listChannels(companyId: string, userId: string) {
    await this.ensureGeneral(companyId, userId);
    await this.ensurePublicMemberships(companyId, userId);

    const memberships = await this.prisma.chatMember.findMany({
      where: { userId, channel: { companyId } },
      include: {
        channel: {
          include: {
            members: { select: { userId: true } },
            messages: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 1, include: { attachment: { select: { filename: true } } } },
          },
        },
      },
    });

    const unreadRows = await this.prisma.$queryRaw<Array<{ channelId: string; unread: number }>>`
      SELECT m."channelId" AS "channelId", COUNT(*)::int AS "unread"
      FROM "chat_messages" m
      JOIN "chat_members" cm ON cm."channelId" = m."channelId" AND cm."userId" = ${userId}
      WHERE m."companyId" = ${companyId}
        AND m."senderUserId" <> ${userId}
        AND m."deletedAt" IS NULL
        AND m."createdAt" > cm."lastReadAt"
      GROUP BY m."channelId"
    `;
    const unreadByChannel = new Map(unreadRows.map((r) => [r.channelId, r.unread]));

    const names = await this.nameMap(
      memberships.flatMap((m) => [...m.channel.members.map((x) => x.userId), ...m.channel.messages.map((x) => x.senderUserId)]),
    );

    return memberships
      .map((m) => {
        const c = m.channel;
        const other = c.kind === ChatChannelKind.DIRECT ? c.members.find((x) => x.userId !== userId) : undefined;
        const last = c.messages[0];
        return {
          id: c.id,
          kind: c.kind,
          name: c.kind === ChatChannelKind.DIRECT ? (names.get(other?.userId ?? "") ?? "Direct message") : (c.name ?? "channel"),
          isPrivate: c.isPrivate,
          memberCount: c.members.length,
          otherUserId: other?.userId ?? null,
          createdByMe: c.createdByUserId === userId,
          unread: unreadByChannel.get(c.id) ?? 0,
          lastMessageAt: c.lastMessageAt,
          lastMessage: last
            ? {
                preview: last.body ? last.body.slice(0, 80) : last.attachment ? `Sent a file: ${last.attachment.filename}` : "",
                senderName: names.get(last.senderUserId) ?? "",
                createdAt: last.createdAt,
              }
            : null,
        };
      })
      .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
  }

  async unreadTotal(companyId: string, userId: string): Promise<{ unread: number }> {
    const rows = await this.prisma.$queryRaw<Array<{ unread: number }>>`
      SELECT COUNT(*)::int AS "unread"
      FROM "chat_messages" m
      JOIN "chat_members" cm ON cm."channelId" = m."channelId" AND cm."userId" = ${userId}
      WHERE m."companyId" = ${companyId}
        AND m."senderUserId" <> ${userId}
        AND m."deletedAt" IS NULL
        AND m."createdAt" > cm."lastReadAt"
    `;
    return { unread: rows[0]?.unread ?? 0 };
  }

  async createChannel(companyId: string, userId: string, dto: { name: string; isPrivate?: boolean; memberUserIds?: string[] }) {
    const name = dto.name.trim().replace(/^#+/, "").replace(/\s+/g, "-").toLowerCase();
    if (!name) throw new BadRequestException("Give the channel a name");
    const clash = await this.prisma.chatChannel.findFirst({ where: { companyId, name }, select: { id: true } });
    if (clash) throw new ConflictException(`A channel called #${name} already exists`);

    const isPrivate = !!dto.isPrivate;
    let memberIds: string[];
    if (isPrivate) {
      memberIds = [...new Set([userId, ...(dto.memberUserIds ?? [])])];
      await this.assertCompanyMembers(companyId, memberIds);
    } else {
      const people = await this.prisma.companyUser.findMany({ where: { companyId, status: "ACTIVE" }, select: { userId: true } });
      memberIds = [...new Set([userId, ...people.map((p) => p.userId)])];
    }
    const channel = await this.prisma.chatChannel.create({
      data: {
        companyId,
        kind: ChatChannelKind.CHANNEL,
        name,
        isPrivate,
        createdByUserId: userId,
        members: { create: memberIds.map((id) => ({ userId: id })) },
      },
    });
    return { id: channel.id, name: channel.name, isPrivate: channel.isPrivate };
  }

  async openDirect(companyId: string, userId: string, otherUserId: string) {
    if (otherUserId === userId) throw new BadRequestException("You can't start a chat with yourself");
    await this.assertCompanyMembers(companyId, [otherUserId]);
    const dmKey = [userId, otherUserId].sort().join(":");
    const existing = await this.prisma.chatChannel.findUnique({ where: { companyId_dmKey: { companyId, dmKey } }, select: { id: true } });
    if (existing) return { id: existing.id };
    try {
      const created = await this.prisma.chatChannel.create({
        data: {
          companyId,
          kind: ChatChannelKind.DIRECT,
          isPrivate: true,
          dmKey,
          createdByUserId: userId,
          members: { create: [{ userId }, { userId: otherUserId }] },
        },
      });
      return { id: created.id };
    } catch (err: any) {
      if (err?.code === "P2002") {
        const again = await this.prisma.chatChannel.findUniqueOrThrow({ where: { companyId_dmKey: { companyId, dmKey } }, select: { id: true } });
        return { id: again.id };
      }
      throw err;
    }
  }

  /** The channel, provided the caller may see it: public ones are open to the company, the rest only to members. */
  private async accessibleChannel(companyId: string, channelId: string, userId: string) {
    const channel = await this.prisma.chatChannel.findFirst({ where: { id: channelId, companyId } });
    if (!channel) throw new NotFoundException("Channel not found");
    const member = await this.prisma.chatMember.findUnique({ where: { channelId_userId: { channelId, userId } } });
    if (member) return { channel, member };
    if (channel.kind === ChatChannelKind.CHANNEL && !channel.isPrivate) {
      const joined = await this.prisma.chatMember.create({ data: { channelId, userId } });
      return { channel, member: joined };
    }
    throw new ForbiddenException("You are not in this conversation");
  }

  async channelDetails(companyId: string, channelId: string, userId: string) {
    const { channel } = await this.accessibleChannel(companyId, channelId, userId);
    const members = await this.prisma.chatMember.findMany({ where: { channelId }, select: { userId: true } });
    const names = await this.nameMap(members.map((m) => m.userId));
    return {
      id: channel.id,
      kind: channel.kind,
      name: channel.kind === ChatChannelKind.DIRECT ? (names.get(members.find((m) => m.userId !== userId)?.userId ?? "") ?? "Direct message") : channel.name,
      isPrivate: channel.isPrivate,
      createdByMe: channel.createdByUserId === userId,
      members: members.map((m) => ({ id: m.userId, name: names.get(m.userId) ?? "" })).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  async addMembers(companyId: string, channelId: string, userId: string, userIds: string[]) {
    const { channel } = await this.accessibleChannel(companyId, channelId, userId);
    if (channel.kind === ChatChannelKind.DIRECT) throw new BadRequestException("A direct message is between two people");
    if (!channel.isPrivate) throw new BadRequestException("Everyone in the company is already in a public channel");
    await this.assertCompanyMembers(companyId, userIds);
    await this.prisma.chatMember.createMany({ data: userIds.map((id) => ({ channelId, userId: id })), skipDuplicates: true });
    return { added: userIds.length };
  }

  async deleteChannel(companyId: string, channelId: string, userId: string) {
    const { channel } = await this.accessibleChannel(companyId, channelId, userId);
    if (channel.kind === ChatChannelKind.DIRECT) throw new BadRequestException("A direct message can't be deleted");
    if (channel.createdByUserId !== userId) throw new ForbiddenException("Only the person who created the channel can delete it");
    await this.prisma.chatChannel.delete({ where: { id: channelId } });
    return { deleted: true };
  }

  // ── messages ────────────────────────────────────────────────────────

  private async shapeMessages(
    rows: Array<{
      id: string;
      senderUserId: string;
      body: string;
      createdAt: Date;
      updatedAt: Date;
      deletedAt: Date | null;
      attachment: { id: string; filename: string; mimeType: string; size: number } | null;
    }>,
  ) {
    const names = await this.nameMap(rows.map((r) => r.senderUserId));
    return rows.map((r) => ({
      id: r.id,
      senderUserId: r.senderUserId,
      senderName: names.get(r.senderUserId) ?? "Former member",
      body: r.deletedAt ? "" : r.body,
      deleted: !!r.deletedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      attachment: r.deletedAt || !r.attachment ? null : { id: r.attachment.id, filename: r.attachment.filename, mimeType: r.attachment.mimeType, size: r.attachment.size },
    }));
  }

  /**
   * Latest page by default. With "changedAfter" it returns only messages created or changed (deleted) since
   * then, which is what the open conversation polls for. With "before" it returns the page of older messages.
   */
  async listMessages(companyId: string, channelId: string, userId: string, opts: { changedAfter?: Date; before?: Date }) {
    await this.accessibleChannel(companyId, channelId, userId);
    const include = { attachment: { select: { id: true, filename: true, mimeType: true, size: true } } };
    if (opts.changedAfter) {
      const rows = await this.prisma.chatMessage.findMany({
        where: { channelId, updatedAt: { gt: opts.changedAfter } },
        orderBy: { createdAt: "asc" },
        take: 200,
        include,
      });
      return { messages: await this.shapeMessages(rows), hasMore: false };
    }
    const rows = await this.prisma.chatMessage.findMany({
      where: { channelId, ...(opts.before ? { createdAt: { lt: opts.before } } : {}) },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE + 1,
      include,
    });
    const hasMore = rows.length > PAGE_SIZE;
    return { messages: await this.shapeMessages(rows.slice(0, PAGE_SIZE).reverse()), hasMore };
  }

  async postMessage(companyId: string, channelId: string, userId: string, body: string | undefined, file?: ChatFileInput) {
    await this.accessibleChannel(companyId, channelId, userId);
    const text = (body ?? "").trim();
    if (!text && !file) throw new BadRequestException("Type a message or attach a file");

    let attachment: { filename: string; mimeType: string; size: number; data: Buffer } | undefined;
    if (file) {
      if (file.size > MAX_FILE_BYTES) throw new BadRequestException("Files can be at most 5 MB");
      const filename = file.originalname.replace(/[\\/\r\n"]/g, "_").slice(0, 150) || "file";
      const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
      if (BLOCKED_EXTENSIONS.has(ext)) throw new BadRequestException(`.${ext} files can't be shared in chat`);
      attachment = { filename, mimeType: file.mimetype || "application/octet-stream", size: file.size, data: file.buffer };
    }

    const now = new Date();
    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.chatMessage.create({
        data: {
          channelId,
          companyId,
          senderUserId: userId,
          body: text,
          createdAt: now,
          updatedAt: now,
          ...(attachment ? { attachment: { create: attachment } } : {}),
        },
        include: { attachment: { select: { id: true, filename: true, mimeType: true, size: true } } },
      });
      await tx.chatChannel.update({ where: { id: channelId }, data: { lastMessageAt: now } });
      // Sending a message means you've read everything up to it.
      await tx.chatMember.update({ where: { channelId_userId: { channelId, userId } }, data: { lastReadAt: now } });
      return created;
    });
    return (await this.shapeMessages([message]))[0];
  }

  async markRead(companyId: string, channelId: string, userId: string) {
    const { member } = await this.accessibleChannel(companyId, channelId, userId);
    await this.prisma.chatMember.update({ where: { id: member.id }, data: { lastReadAt: new Date() } });
    return { ok: true };
  }

  async deleteMessage(companyId: string, messageId: string, userId: string) {
    const message = await this.prisma.chatMessage.findFirst({ where: { id: messageId, companyId } });
    if (!message) throw new NotFoundException("Message not found");
    if (message.senderUserId !== userId) throw new ForbiddenException("You can only delete your own messages");
    await this.prisma.$transaction([
      this.prisma.chatAttachment.deleteMany({ where: { messageId } }),
      this.prisma.chatMessage.update({ where: { id: messageId }, data: { body: "", deletedAt: new Date() } }),
    ]);
    return { deleted: true };
  }

  async getAttachment(companyId: string, attachmentId: string, userId: string) {
    const attachment = await this.prisma.chatAttachment.findUnique({ where: { id: attachmentId }, include: { message: true } });
    if (!attachment || attachment.message.companyId !== companyId) throw new NotFoundException("File not found");
    await this.accessibleChannel(companyId, attachment.message.channelId, userId);
    return { filename: attachment.filename, mimeType: attachment.mimeType, data: Buffer.from(attachment.data) };
  }
}
