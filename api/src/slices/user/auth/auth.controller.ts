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
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from './domain';
import { IAuthSessionResult } from './domain/auth.service';
import { IAuthTokenPayload } from './domain/auth.types';
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
import { SESSION_COOKIE_NAME } from '../session/domain/session.types';
import { ApiKeyGuard, JwtAuthGuard, Scopes, ScopesGuard } from './guards';

export const TOKEN_UNAUTHORIZED_DESCRIPTION =
  'Missing, expired or invalid bearer. Body is `{ code: ' +
  "'TOKEN_MISSING' | 'TOKEN_EXPIRED' | 'TOKEN_INVALID', message }`. " +
  'Consoles renew via POST /auth/refresh on TOKEN_EXPIRED / TOKEN_INVALID and retry once.';

export const SESSION_UNAUTHORIZED_DESCRIPTION =
  'The session cookie is missing, unknown, revoked or past its idle/absolute ' +
  "window. Body is `{ code: 'SESSION_MISSING' | 'SESSION_EXPIRED' | " +
  "'SESSION_INVALID', message }`. The console shows its session-ended state.";

/**
 * Console sign-in is a pair: the access token in the body (short-lived) and
 * the session secret in an httpOnly cookie scoped to `/auth` (CLEAN-72).
 * `applySession` is the only place the cookie is written, so the DTO can
 * never carry the secret by accident.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private apiKeys: ApiKeyService,
    private sessions: SessionService,
  ) {}

  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Authenticate: returns a short-lived access token and sets the httpOnly session cookie used by POST /auth/refresh',
  })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthDto> {
    const result = await this.authService.login(
      dto.email,
      dto.password,
      userAgentOf(req),
    );
    return this.applySession(res, result);
  }

  @Post('register')
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Self-service signup. Requires the 'auth.registration_enabled' setting to be true; otherwise 403. Sets the session cookie like login.",
  })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthDto> {
    const result = await this.authService.register(
      dto.name,
      dto.email,
      dto.password,
      userAgentOf(req),
    );
    return this.applySession(res, result);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Renew the access token from the session cookie alone (works after the access token expired). Slides the session inactivity window and re-sets the cookie. No body; send credentials.',
  })
  @ApiUnauthorizedResponse({ description: SESSION_UNAUTHORIZED_DESCRIPTION })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthDto> {
    const result = await this.authService.refresh(sessionCookieOf(req));
    return this.applySession(res, result);
  }

  @Post('logout')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Revoke the session behind the cookie and clear it. Always 200; `revoked` is false when nothing live matched.',
  })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LogoutResultDto> {
    const revoked = await this.authService.logout(sessionCookieOf(req));
    res.clearCookie(SESSION_COOKIE_NAME, this.sessions.clearCookieOptions());
    return { revoked };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the current authenticated user' })
  @ApiUnauthorizedResponse({ description: TOKEN_UNAUTHORIZED_DESCRIPTION })
  async me(
    @Req() req: Request & { user: IAuthTokenPayload },
  ): Promise<UserDto> {
    return this.authService.me(req.user.sub);
  }

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

  private applySession(res: Response, result: IAuthSessionResult): AuthDto {
    res.cookie(
      SESSION_COOKIE_NAME,
      result.cookie.value,
      this.sessions.cookieOptions(result.cookie.maxAgeSeconds),
    );
    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
    };
  }
}

export function sessionCookieOf(req: Request): string {
  const cookies = (req as { cookies?: Record<string, unknown> }).cookies;
  const value = cookies?.[SESSION_COOKIE_NAME];
  return typeof value === 'string' ? value : '';
}

export function userAgentOf(req: Request): string | null {
  const ua = req.headers?.['user-agent'];
  return typeof ua === 'string' && ua ? ua : null;
}
