import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createTransport, Transporter } from "nodemailer";
import { AppConfig } from "../../core/config/configuration";

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly fromAddress: string;

  constructor(configService: ConfigService<AppConfig, true>) {
    const mail = configService.get("mail", { infer: true });
    this.fromAddress = mail.fromAddress;
    this.transporter = mail.smtpHost
      ? createTransport({
          host: mail.smtpHost,
          port: mail.smtpPort,
          secure: mail.smtpPort === 465,
          auth: mail.smtpUser ? { user: mail.smtpUser, pass: mail.smtpPass } : undefined,
        })
      : null;
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
