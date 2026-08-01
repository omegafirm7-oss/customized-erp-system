import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ConfigService } from "@nestjs/config";
import { Strategy, VerifyCallback, Profile } from "passport-google-oauth20";
import { AppConfig } from "../../core/config/configuration";
import { AuthService } from "../auth.service";

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, "google") {
  constructor(
    configService: ConfigService<AppConfig, true>,
    private readonly authService: AuthService,
  ) {
    const google = configService.get("google", { infer: true });
    super({
      clientID: google.clientId,
      clientSecret: google.clientSecret,
      callbackURL: google.callbackUrl,
      scope: ["email", "profile"],
    });
  }

  async validate(_accessToken: string, _refreshToken: string, profile: Profile, done: VerifyCallback): Promise<void> {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      done(new Error("Google account has no email"), false);
      return;
    }
    const user = await this.authService.findOrCreateGoogleUser(profile.id, email, profile.displayName || email);
    done(null, user);
  }
}
