import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createTransport, Transporter } from "nodemailer";
import { AppConfig } from "../../core/config/configuration";

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly fromAddress: string;
  private readonly smtpUser: string;

  constructor(configService: ConfigService<AppConfig, true>) {
    const mail = configService.get("mail", { infer: true });
    this.fromAddress = mail.fromAddress;
    this.smtpUser = mail.smtpUser;
    this.transporter = mail.smtpHost
      ? createTransport({
          host: mail.smtpHost,
          port: mail.smtpPort,
          secure: mail.smtpPort === 465,
          auth: mail.smtpUser ? { user: mail.smtpUser, pass: mail.smtpPass } : undefined,
        })
      : null;
  }

  isConfigured(): boolean {
    return this.transporter !== null;
  }

  /**
   * CRM outreach email. Unlike the password-reset path this THROWS on
   * failure — the caller records the error on the activity and shows it to
   * the user, since a silently-dropped sales email is worse than a visible
   * one. Sent from the authenticated SMTP mailbox itself (Microsoft 365
   * rejects any From address the mailbox has no send-as right for), with
   * the company name as display name.
   */
  async sendOutreachEmail(params: {
    to: string;
    subject: string;
    text: string;
    senderName: string;
    replyTo?: string | null;
    /** Images are embedded under the text (cid:), anything else is attached. */
    files?: { fileName: string; mimeType: string; data: Buffer }[];
  }): Promise<void> {
    if (!this.transporter) {
      throw new Error("Outgoing email is not configured on the server (SMTP settings missing)");
    }
    const files = params.files ?? [];
    const images = files.map((f, i) => ({ ...f, cid: `flyer${i}@outreach` })).filter((f) => f.mimeType.startsWith("image/"));
    const html =
      params.text
        .split(/\n{2,}/)
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
        .join("") +
      images
        .map(
          (img) =>
            `<p><img src="cid:${img.cid}" alt="${escapeHtml(img.fileName)}" width="600" style="max-width:100%;height:auto;display:block;border:0"></p>`,
        )
        .join("");
    await this.transporter.sendMail({
      from: this.smtpUser ? { name: params.senderName, address: this.smtpUser } : this.fromAddress,
      to: params.to,
      replyTo: params.replyTo || undefined,
      subject: params.subject,
      text: params.text,
      html,
      attachments: files.map((f, i) => ({
        filename: f.fileName,
        content: f.data,
        contentType: f.mimeType,
        ...(f.mimeType.startsWith("image/") ? { cid: `flyer${i}@outreach`, contentDisposition: "inline" as const } : {}),
      })),
    });
  }

  /**
   * Silently no-ops (with a log line) until SMTP_HOST is configured — lets
   * the password-reset flow work end-to-end in dev/tests without real
   * credentials, and fail safe rather than crash a request in production if
   * mail delivery is ever briefly unreachable.
   */
  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(`SMTP not configured — skipping password reset email to ${to}. Link: ${resetUrl}`);
      return;
    }
    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to,
        subject: "Reset your Universa Centrix password",
        text: `Reset your password using the link below. It expires in 30 minutes.\n\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`,
        html: `<p>Reset your Universa Centrix password using the link below. It expires in 30 minutes.</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't request this, you can safely ignore this email.</p>`,
      });
    } catch (err) {
      this.logger.error(`Failed to send password reset email to ${to}`, err as Error);
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
