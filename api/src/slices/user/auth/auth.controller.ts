import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from './domain';
import { IAuthSessionResult } from './domain/auth.service';
import {
  AuthErrorCodes,
  IAuthTokenPayload,
  unauthorized,
} from './domain/auth.types';
import {
  AuthDto,
  EmbedTokenDto,
  EmbedTokenResultDto,
  LoginDto,
  LogoutResultDto,
  RegisterDto,
} from './dtos';
import { UserDto } from '../user/dtos';
import { ApiKeyScopeTypes, IApiKeyData } from '../apiKey/domain';
import { ApiKeyService } from '../apiKey/domain/apiKey.service';
import { SessionService } from '../session/domain/session.service';
import {
  LEGACY_SESSION_COOKIE_NAME,
  SESSION_CONSOLE_HEADER,
  sessionCookieName,
  sessionSurfaceOf,
  type SessionSurface,
} from '../session/domain/session.types';
import {
  ApiKeyGuard,
  JwtAuthGuard,
  Public,
  Roles,
  Scopes,
  ScopesGuard,
} from './guards';
import { UserRoleTypes } from '../user/domain';

export const TOKEN_UNAUTHORIZED_DESCRIPTION =
  'Missing, expired or invalid bearer. Body is `{ code: ' +
  "'TOKEN_MISSING' | 'TOKEN_EXPIRED' | 'TOKEN_INVALID', message }`. " +
  'Consoles renew via POST /auth/refresh on TOKEN_EXPIRED / TOKEN_INVALID and retry once.';

export const SESSION_UNAUTHORIZED_DESCRIPTION =
  'The session cookie is missing, unknown, revoked, past its idle/absolute ' +
  'window, or was made in the other console. Body is `{ code: ' +
  "'SESSION_MISSING' | 'SESSION_EXPIRED' | 'SESSION_INVALID', message }`. " +
  'The console shows its session-ended state.';

export const CONSOLE_HEADER_DESCRIPTION =
  'The console the request comes from. A sign-in belongs to the console it ' +
  'was made in: each has a session cookie of its own and renews only its ' +
  'own. Without the header no cookie is set or read: a sign-in then ' +
  'returns the access token alone, and a renewal finds no session.';

/** Swagger for the header every sign-in route reads. */
export const ApiConsoleHeader = () =>
  ApiHeader({
    name: 'X-Ranch-Console',
    required: false,
    enum: ['admin', 'app'],
    description: CONSOLE_HEADER_DESCRIPTION,
  });

/**
 * Console sign-in is a pair: the access token in the body (short-lived) and
 * the session secret in an httpOnly cookie scoped to `/auth` (CLEAN-72).
 * `applySession` is the only place the cookie is written, so the DTO can
 * never carry the secret by accident.
 *
 * A sign-in belongs to the console it was made in (CLEAN-236). The console
 * names itself in `X-Ranch-Console`; the session records it, the cookie is
 * that console's own, and renewing or signing out touches only that one.
 * The header selects, it does not authorise: what makes the admin's sign-in
 * useless to the user console is the console recorded on the session row.
 *
 * A request that names no console (a script signing in for a token) gets the
 * access token and no cookie, and has nothing to renew.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private apiKeys: ApiKeyService,
    private sessions: SessionService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiConsoleHeader()
  @ApiOperation({
    summary:
      'Authenticate: returns a short-lived access token and sets the httpOnly session cookie used by POST /auth/refresh',
  })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthDto> {
    const surface = consoleOf(req);
    const result = await this.authService.login(
      dto.email,
      dto.password,
      surface,
      userAgentOf(req),
    );
    return this.applySession(req, res, result, surface);
  }

  @Public()
  @Post('register')
  @HttpCode(200)
  @ApiConsoleHeader()
  @ApiOperation({
    summary:
      "Self-service signup. Requires the 'auth.registration_enabled' setting to be true; otherwise 403. Sets the session cookie like login.",
  })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthDto> {
    const surface = consoleOf(req);
    const result = await this.authService.register(
      dto.name,
      dto.email,
      dto.password,
      surface,
      userAgentOf(req),
    );
    return this.applySession(req, res, result, surface);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiConsoleHeader()
  @ApiOperation({
    summary:
      'Renew the access token from the session cookie alone (works after the access token expired). Slides the session inactivity window and re-sets the cookie. No body; send credentials.',
  })
  @ApiUnauthorizedResponse({ description: SESSION_UNAUTHORIZED_DESCRIPTION })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthDto> {
    dropLegacyCookie(req, res, this.sessions);
    const surface = consoleOf(req);
    // A request that does not say which console it is has no sign-in: there
    // is no default, a default would be the shared cookie again.
    if (!surface) throw unauthorized(AuthErrorCodes.SessionInvalid);
    const result = await this.authService.refresh(
      sessionCookieOf(req, surface),
      surface,
    );
    return this.applySession(req, res, result, surface);
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  @ApiConsoleHeader()
  @ApiOperation({
    summary:
      'Revoke the session behind the cookie and clear it. Always 200; `revoked` is false when nothing live matched.',
  })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LogoutResultDto> {
    dropLegacyCookie(req, res, this.sessions);
    const surface = consoleOf(req);
    if (!surface) return { revoked: false };
    const revoked = await this.authService.logout(
      sessionCookieOf(req, surface),
      surface,
    );
    // This console's cookie, and only this one: the other console stays
    // signed in.
    res.clearCookie(
      sessionCookieName(surface),
      this.sessions.clearCookieOptions(),
    );
    return { revoked };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  // Every signed-in account reads its own session (CLEAN-232). An agent
  // runtime's token is not an account and is refused.
  @Roles(UserRoleTypes.User)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the current authenticated user' })
  @ApiUnauthorizedResponse({ description: TOKEN_UNAUTHORIZED_DESCRIPTION })
  async me(
    @Req() req: Request & { user: IAuthTokenPayload },
  ): Promise<UserDto> {
    return this.authService.me(req.user.sub);
  }

  @Public()
  @Post('embed/token')
  @HttpCode(200)
  @UseGuards(ApiKeyGuard, ScopesGuard)
  @Scopes(ApiKeyScopeTypes.EmbedMint)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Mint a short-lived browser embed JWT for the bridle widget. Auth: API key with embed:mint scope. Owner/Admin roles are stripped from the result unless the key also carries embed:mint-admin — then they are kept and the TTL is capped at 7d.',
  })
  embedToken(
    @Req() req: Request & { apiKey: IApiKeyData },
    @Body() dto: EmbedTokenDto,
  ): Promise<EmbedTokenResultDto> {
    return this.authService.mintEmbedToken({
      sub: dto.sub,
      email: dto.email,
      roles: dto.roles,
      expiresIn: dto.expiresIn,
      allowAdminRoles: this.apiKeys.hasScope(
        req.apiKey,
        ApiKeyScopeTypes.EmbedMintAdmin,
      ),
    });
  }

  private applySession(
    req: Request,
    res: Response,
    result: IAuthSessionResult,
    surface: SessionSurface | null,
  ): AuthDto {
    dropLegacyCookie(req, res, this.sessions);
    // No console, no cookie: nothing of this sign-in is left in the browser
    // for either console to pick up.
    if (surface) {
      res.cookie(
        sessionCookieName(surface),
        result.cookie.value,
        this.sessions.cookieOptions(result.cookie.maxAgeSeconds),
      );
    }
    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
    };
  }
}

/** The console a request says it comes from, or null when it does not say. */
export function consoleOf(req: Request): SessionSurface | null {
  return sessionSurfaceOf(req.headers?.[SESSION_CONSOLE_HEADER]);
}

/** The secret in the cookie of one console, and of no other. */
export function sessionCookieOf(req: Request, surface: SessionSurface): string {
  const cookies = (req as { cookies?: Record<string, unknown> }).cookies;
  const value = cookies?.[sessionCookieName(surface)];
  return typeof value === 'string' ? value : '';
}

/**
 * Clears the cookie both consoles used to share, when the browser still
 * sends it. It is never read: a sign-in from before CLEAN-236 cannot be said
 * to belong to either console, so each asks for a sign-in once.
 */
export function dropLegacyCookie(
  req: Request,
  res: Response,
  sessions: SessionService,
): void {
  const cookies = (req as { cookies?: Record<string, unknown> }).cookies;
  if (cookies?.[LEGACY_SESSION_COOKIE_NAME] === undefined) return;
  res.clearCookie(LEGACY_SESSION_COOKIE_NAME, sessions.clearCookieOptions());
}

export function userAgentOf(req: Request): string | null {
  const ua = req.headers?.['user-agent'];
  return typeof ua === 'string' && ua ? ua : null;
}
