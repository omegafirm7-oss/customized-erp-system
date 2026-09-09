import { BadRequestException, ConflictException, GoneException, Injectable, NotFoundException } from "@nestjs/common";
import { PhotoUploadSessionStatus } from "@prisma/client";
import { randomBytes } from "crypto";
import { PrismaService } from "../common/prisma/prisma.service";

const SESSION_TTL_MS = 10 * 60 * 1000;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * Lets a desktop user pull a photo in from their phone's own camera without
 * any device pairing: the desktop creates a session and shows its token as
 * a QR code; the phone (no login required) opens that link, takes a photo
 * with its own camera — instant, since it's the phone's own OS handling
 * capture, not a cross-device continuity feature — and posts it back here;
 * the desktop polls the same session and pulls the photo in once it lands.
 */
@Injectable()
export class PhotoUploadService {
  constructor(private readonly prisma: PrismaService) {}

  async createSession(companyId: string, userId: string) {
    await this.purgeExpired();
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.prisma.photoUploadSession.create({
      data: { token, companyId, createdByUserId: userId, expiresAt },
    });
    return { token, expiresAt };
  }

  /** Public — used by both the desktop poller and the phone page. Reveals only status, never file content. */
  async getStatus(token: string) {
    const session = await this.prisma.photoUploadSession.findUnique({ where: { token } });
    if (!session) {
      throw new NotFoundException("This upload link is invalid or has already been used");
    }
    if (session.expiresAt < new Date()) {
      throw new GoneException("This upload link has expired — go back to the desktop and start again");
    }
    return { status: session.status };
  }

  /** Public — the phone posts its photo here with no login. */
  async uploadPhoto(token: string, file: Express.Multer.File) {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException("Only JPEG, PNG, WEBP, or GIF photos are accepted");
    }
    const session = await this.prisma.photoUploadSession.findUnique({ where: { token } });
    if (!session) {
      throw new NotFoundException("This upload link is invalid or has already been used");
    }
    if (session.expiresAt < new Date()) {
      throw new GoneException("This upload link has expired — go back to the desktop and start again");
    }
    if (session.status === PhotoUploadSessionStatus.UPLOADED) {
      throw new ConflictException("A photo has already been uploaded for this link");
    }

    await this.prisma.photoUploadSession.update({
      where: { token },
      data: {
        status: PhotoUploadSessionStatus.UPLOADED,
        filename: file.originalname || "photo.jpg",
        mimeType: file.mimetype,
        size: file.size,
        data: file.buffer,
      },
    });
    return { ok: true };
  }

  /** Authenticated, company-scoped — the desktop's one-time pull of the uploaded photo. Deletes the session once served. */
  async collectResult(companyId: string, token: string) {
    const session = await this.prisma.photoUploadSession.findFirst({ where: { token, companyId } });
    if (!session) {
      throw new NotFoundException("Upload session not found");
    }
    if (session.status !== PhotoUploadSessionStatus.UPLOADED || !session.data) {
      throw new NotFoundException("No photo has been uploaded for this session yet");
    }
    await this.prisma.photoUploadSession.delete({ where: { token } });
    return { filename: session.filename!, mimeType: session.mimeType!, data: session.data };
  }

  /** Best-effort janitor: drop expired sessions (including any never collected) whenever a new one is created. */
  async purgeExpired() {
    await this.prisma.photoUploadSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }
}
