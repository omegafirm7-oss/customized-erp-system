import { Body, Controller, Get, Post, Req, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Request, Response } from "express";
import { User } from "@prisma/client";
import { AuthService, IssuedTokens } from "./auth.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { SwitchCompanyDto } from "./dto/switch-company.dto";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { Public } from "../common/decorators/public.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtPayload } from "./types/jwt-payload.type";
import { GoogleAuthGuard } from "./guards/google-auth.guard";

const REFRESH_COOKIE_NAME = "erp_refresh_token";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post("register")
  async register(@Body() dto: RegisterDto) {
    const user = await this.authService.register(dto.email, dto.password, dto.fullName);
    return { id: user.id, email: user.email, fullName: user.fullName };
  }

  @Public()
  @Post("login")
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.authService.validateUserCredentials(dto.email, dto.password);
    if (!user) {
      throw new UnauthorizedException("Invalid email or password");
    }
    const tokens = await this.authService.login(user.id, this.requestMeta(req));
    this.setRefreshCookie(res, tokens);
    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
  }

  @Public()
  @Post("refresh")
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!rawToken) {
      throw new UnauthorizedException("No refresh token presented");
    }
    const tokens = await this.authService.refresh(rawToken, this.requestMeta(req));
    this.setRefreshCookie(res, tokens);
    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
  }

  @Public()
  @Get("google")
  @UseGuards(GoogleAuthGuard)
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  async googleAuth(): Promise<void> {
    // Passport's Google strategy intercepts this request and redirects to
    // Google's consent screen — this handler body never actually runs.
  }

  @Public()
  @Get("google/callback")
  @UseGuards(GoogleAuthGuard)
  async googleCallback(@Req() req: Request, @Res() res: Response): Promise<void> {
    const user = req.user as User;
    const tokens = await this.authService.login(user.id, this.requestMeta(req));
    this.setRefreshCookie(res, tokens);
    // This request is a top-level browser navigation back from Google, not
    // an AJAX call — the access token can't be handed back as JSON body.
    // Pass it in the URL fragment instead of relying on the frontend calling
    // /auth/refresh to derive one from the cookie: a fragment never reaches
    // this server (or any proxy/log) and the frontend can read it
    // synchronously on load. This also sidesteps a real race that was
    // occurring when the frontend "picked the session up from the cookie" by
    // calling refresh() itself — see AuthCallbackPage.tsx for the full story.
    res.redirect(`/auth/callback#at=${encodeURIComponent(tokens.accessToken)}`);
  }

  @Public()
  @Post("forgot-password")
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.requestPasswordReset(dto.email);
    // Identical response whether or not the email is registered — see
    // AuthService.requestPasswordReset for why.
    return { message: "If that email is registered, a reset link has been sent." };
  }

  @Public()
  @Post("reset-password")
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    return { success: true };
  }

  /**
   * Called by the frontend's IdleTimeoutGuard, throttled, on real user
   * activity — the server-side half of idle-timeout enforcement (see
   * AuthService.touchActivity). Not itself proof the session is fine: it
   * still revokes and 401s if the gap since the last heartbeat exceeded the
   * idle+warning window, which is what makes a stale session actually die
   * server-side instead of only in whichever tab's JS timer happens to fire.
   */
  @Public()
  @Post("heartbeat")
  async heartbeat(@Req() req: Request) {
    const rawToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!rawToken) {
      throw new UnauthorizedException("No refresh token presented");
    }
    await this.authService.touchActivity(rawToken);
    return { ok: true };
  }

  @Public()
  @Post("logout")
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (rawToken) {
      await this.authService.revoke(rawToken, this.requestMeta(req));
    }
    res.clearCookie(REFRESH_COOKIE_NAME);
    return { success: true };
  }

  @ApiBearerAuth()
  @Post("switch-company")
  async switchCompany(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SwitchCompanyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.switchCompany(user.sub, dto.companyId, this.requestMeta(req));
    this.setRefreshCookie(res, tokens);
    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
  }

  private requestMeta(req: Request) {
    return { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
  }

  private setRefreshCookie(res: Response, tokens: IssuedTokens) {
    res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      expires: tokens.refreshExpiresAt,
      // Scoped to "/", not "/auth": the frontend calls this API through a
      // proxy prefix (e.g. /api/auth/refresh), so a narrower path based on
      // the API's own route structure would never actually match and the
      // browser would silently withhold the cookie on every request.
      path: "/",
    });
  }
}
