import { ExecutionContext, Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

/**
 * Wraps the base "google" passport strategy so a failed/denied Google
 * OAuth attempt (no email scope granted, user cancels the consent screen,
 * Google returns an error) redirects back to the login page with a visible
 * error instead of Nest's default JSON 401 — which the browser shows as a
 * blank/broken page after the top-level navigation back from Google.
 */
@Injectable()
export class GoogleAuthGuard extends AuthGuard("google") {
  getAuthenticateOptions(_context: ExecutionContext) {
    return { failureRedirect: "/login?error=google_auth_failed" };
  }
}
