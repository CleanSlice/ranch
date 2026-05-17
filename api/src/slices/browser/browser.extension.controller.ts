import {
  Body,
  Controller,
  Headers,
  Logger,
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
import {
  ImportStateDto,
  ImportStateResponseDto,
  IssueExtensionTokenDto,
  IssueExtensionTokenResponseDto,
} from './dtos';
import { IAuthTokenPayload } from '../user/auth/domain/auth.types';
import { JwtAuthGuard } from '../user/auth/guards';

interface IExtensionTokenPayload {
  /** Ranch user that minted the token (audit/replay). */
  sub: string;
  /** Agent the imported state belongs to. */
  agentId: string;
  /** User ID within that agent (Telegram id, "admin", etc.). */
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
  async issueToken(
    @Body() dto: IssueExtensionTokenDto,
    @Req() req: Request & { user: IAuthTokenPayload },
  ): Promise<IssueExtensionTokenResponseDto> {
    // Cap at 365 days — practical upper bound for "set it once" UX
    // without making compromised tokens valid forever.
    const ttlDays = Math.max(1, Math.min(365, dto.ttlDays ?? 30));
    const expiresIn = `${ttlDays}d`;
    const token = this.jwt.sign(
      {
        sub: req.user.sub,
        agentId: dto.agentId,
        userId: dto.userId,
        scope: 'browser:cookies',
      } satisfies Omit<IExtensionTokenPayload, 'iat' | 'exp'>,
      { expiresIn },
    );
    const decoded = this.jwt.decode<IExtensionTokenPayload>(token);
    return { token, exp: decoded?.exp ?? 0 };
  }

  @Post('import-state')
  @ApiOperation({
    summary:
      'Receive cookies harvested from the user\'s own Chrome and write them as a Playwright storageState file under the agent\'s S3 prefix. Authentication: Bearer <ext-token> minted via /browser/extension/token.',
    operationId: 'importBrowserStorageState',
  })
  @ApiOkResponse({ type: ImportStateResponseDto })
  async importState(
    @Body() dto: ImportStateDto,
    @Headers('authorization') auth?: string,
  ): Promise<{ success: true; data: ImportStateResponseDto }> {
    const token = this.parseBearer(auth);
    const payload = this.verifyExtensionToken(token);
    const result = await this.gateway.importStorageState(
      payload.agentId,
      payload.userId,
      dto.profile,
      dto.cookies,
      dto.origins ?? [],
    );
    // Response wrapper matches the FlatResponse interceptor's envelope
    // ({success, data}) so the extension can parse identically against
    // dev/prod.
    return {
      success: true,
      data: { ok: true, path: result.path, cookies: result.cookies },
    };
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
