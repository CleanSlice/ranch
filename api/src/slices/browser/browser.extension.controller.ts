import {
  Body,
  Controller,
  ForbiddenException,
  forwardRef,
  Headers,
  Inject,
  Logger,
  NotFoundException,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { IBrowserGateway } from './domain';
import { IBridleGateway } from '#/bridle/domain';
import {
  ImportStateDto,
  ImportStateResponseDto,
  IssueExtensionTokenDto,
  IssueExtensionTokenResponseDto,
} from './dtos';
import { IAuthTokenPayload } from '../user/auth/domain/auth.types';
import { JwtAuthGuard, Public, Roles } from '../user/auth/guards';
import { UserRoleTypes } from '../user/user/domain/user.types';
import { AgentScoped } from '../user/agentAccess/guards';
import { AgentAccessService } from '../user/agentAccess/domain/agentAccess.service';
import {
  clientIdFromJwtPayload,
  clientIdOfAccount,
} from '#/bridle/domain/chatIdentity';

interface IExtensionTokenPayload {
  /** Ranch user that minted the token (audit/replay). */
  sub: string;
  /** Agent the imported state belongs to. */
  agentId: string;
  /**
   * The chat identity the token was minted for. Informational since
   * CLEAN-243: an import files the cookies under the minting account's
   * identity as it is on the day of the import.
   */
  userId: string;
  scope: 'browser:cookies';
  iat: number;
  exp: number;
}

/**
 * Endpoints called by the Ranch Cookies Chrome extension.
 *
 * Why a separate controller: `import-state` accepts a token whose scope
 * (`browser:cookies`) is narrower than a normal user JWT — it must NOT
 * be guarded by JwtAuthGuard, which would accept any logged-in session
 * regardless of scope. Keeping these endpoints out of BrowserController
 * (which has `@UseGuards(JwtAuthGuard)` at the class level) lets us
 * verify the token manually with the right scope check.
 */
@ApiTags('browser')
@Controller('browser/extension')
export class BrowserExtensionController {
  private readonly logger = new Logger(BrowserExtensionController.name);

  constructor(
    private readonly gateway: IBrowserGateway,
    private readonly jwt: JwtService,
    private readonly access: AgentAccessService,
    @Inject(forwardRef(() => IBridleGateway))
    private readonly bridle: IBridleGateway,
  ) {}

  @Post('token')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Mint a long-lived JWT that authorises the Chrome extension to import cookies into the given agent + userId scope. Admin UI calls this on behalf of the logged-in user.',
    operationId: 'issueBrowserExtensionToken',
  })
  @ApiOkResponse({ type: IssueExtensionTokenResponseDto })
  @UseGuards(JwtAuthGuard)
  // Any signed-in person, for an agent they reach (CLEAN-243): the cookies
  // land in their own browser state, filed under their chat identity below.
  @Roles(UserRoleTypes.User)
  // The token imports cookies into one agent; minting it takes reaching
  // that agent (CLEAN-231).
  @AgentScoped('body.agentId')
  async issueToken(
    @Body() dto: IssueExtensionTokenDto,
    @Req() req: Request & { user: IAuthTokenPayload },
  ): Promise<IssueExtensionTokenResponseDto> {
    // Cap at 365 days — practical upper bound for "set it once" UX
    // without making compromised tokens valid forever.
    const ttlDays = Math.max(1, Math.min(365, dto.ttlDays ?? 30));
    // Whose cookies these are is the caller's own chat identity, the name
    // the runtime files a person's browser state under: the Owner is
    // `admin`, anyone else their id (CLEAN-236). The body used to say, and
    // every Admin and User sent `admin` — into the Owner's file (CLEAN-243).
    const identity = clientIdFromJwtPayload(
      req.user as unknown as Record<string, unknown>,
    );
    if (!identity) {
      throw new ForbiddenException('This token names no person.');
    }
    const token = this.jwt.sign(
      {
        sub: req.user.sub,
        agentId: dto.agentId,
        userId: identity.clientId,
        scope: 'browser:cookies',
      } satisfies Omit<IExtensionTokenPayload, 'iat' | 'exp'>,
      { expiresIn: `${ttlDays} days` },
    );
    const decoded = this.jwt.decode<IExtensionTokenPayload>(token);
    return { token, exp: decoded?.exp ?? 0 };
  }

  @Public()
  @Post('import-state')
  @ApiOperation({
    summary:
      "Receive cookies harvested from the user's own Chrome and write them as a Playwright storageState file under the agent's S3 prefix. Authentication: Bearer <ext-token> minted via /browser/extension/token.",
    operationId: 'importBrowserStorageState',
  })
  @ApiOkResponse({ type: ImportStateResponseDto })
  async importState(
    @Body() dto: ImportStateDto,
    @Headers('authorization') auth?: string,
  ): Promise<ImportStateResponseDto> {
    const token = this.parseBearer(auth);
    const payload = this.verifyExtensionToken(token);
    // The token lives up to a year, and what it was minted with was true on
    // that day only. Asked again on every use, with the minting account's
    // role and lists as the database has them now (CLEAN-231): an account
    // that was deleted or disabled, or that no longer reaches the agent,
    // imports nothing. The 404 of an agent that does not exist, either way.
    const account = await this.access.accountReachingExisting(
      payload.sub,
      payload.agentId,
    );
    if (!account) {
      this.logger.warn(
        `Extension token refused: sub=${payload.sub} no longer reaches agent=${payload.agentId}`,
      );
      throw new NotFoundException('Agent not found');
    }
    const result = await this.gateway.importStorageState(
      payload.sub,
      payload.agentId,
      // The account's identity today, not the token's claim: a token an
      // Admin minted before CLEAN-243 names `admin`, the Owner's file.
      clientIdOfAccount(account),
      dto.profile,
      dto.cookies,
      dto.origins ?? [],
      dto.userAgent,
    );
    // The running agent restored its storage at boot and would not see the
    // file until the next one (CLEAN-243).
    this.bridle.notifyBrowserStateImported(payload.agentId, result.path);
    // Return the raw payload — ResponseInterceptor wraps it as
    // {success: true, data: <this>}. Pre-wrapping here would produce
    // {success, data: {success, data: …}} and break the extension's
    // single-level unwrap.
    return { ok: true, path: result.path, cookies: result.cookies };
  }

  private parseBearer(header: string | undefined): string {
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Bearer token required');
    }
    return header.slice('Bearer '.length).trim();
  }

  private verifyExtensionToken(token: string): IExtensionTokenPayload {
    let payload: IExtensionTokenPayload;
    try {
      payload = this.jwt.verify<IExtensionTokenPayload>(token);
    } catch (err) {
      this.logger.warn(`Extension token rejected: ${(err as Error).message}`);
      throw new UnauthorizedException('Invalid extension token');
    }
    if (payload.scope !== 'browser:cookies') {
      throw new UnauthorizedException(
        'Token scope mismatch — expected browser:cookies',
      );
    }
    if (!payload.agentId || !payload.userId) {
      throw new UnauthorizedException(
        'Token missing required agentId/userId claims',
      );
    }
    return payload;
  }
}
