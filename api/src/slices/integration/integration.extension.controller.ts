import { existsSync } from 'fs';
import * as path from 'path';
import {
  Body,
  Controller,
  Get,
  Headers,
  Logger,
  NotFoundException,
  Post,
  Req,
  Res,
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
import * as archiver from 'archiver';
import { Request, Response } from 'express';
import { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import { JwtAuthGuard } from '#/user/auth/guards';
import { IntegrationService } from './domain/integration.service';
import {
  ExtensionImportStateDto,
  ExtensionImportStateResponseDto,
  IssueIntegrationExtensionTokenDto,
  IssueIntegrationExtensionTokenResponseDto,
} from './dtos';

interface IIntegrationExtensionTokenPayload {
  /** Ranch user that minted the token (audit/replay). Owns the imported cookies. */
  sub: string;
  scope: 'integration:cookies';
  iat: number;
  exp: number;
}

/**
 * Endpoints called by the Ranch Cookies Chrome extension when running in
 * integration-target mode. Sibling to `browser.extension.controller.ts`:
 * same token model, narrower scope (`integration:cookies`), no agentId
 * since per-user integrations don't bind to a specific agent.
 */
@ApiTags('integrations')
@Controller('integrations/extension')
export class IntegrationExtensionController {
  private readonly logger = new Logger(IntegrationExtensionController.name);

  constructor(
    private readonly service: IntegrationService,
    private readonly jwt: JwtService,
  ) {}

  @Post('token')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Mint a long-lived JWT that authorises the Chrome extension to push cookies into the caller’s integration store. Admin UI calls this on behalf of the logged-in user. Mirrors /browser/extension/token but with a narrower scope and no agentId.',
    operationId: 'issueIntegrationExtensionToken',
  })
  @ApiOkResponse({ type: IssueIntegrationExtensionTokenResponseDto })
  @UseGuards(JwtAuthGuard)
  async issueToken(
    @Body() dto: IssueIntegrationExtensionTokenDto,
    @Req() req: Request & { user: IAuthTokenPayload },
  ): Promise<IssueIntegrationExtensionTokenResponseDto> {
    const ttlDays = Math.max(1, Math.min(365, dto.ttlDays ?? 30));
    const expiresIn = `${ttlDays}d` as `${number}d`;
    const token = this.jwt.sign(
      {
        sub: req.user.sub,
        scope: 'integration:cookies',
      } satisfies Omit<IIntegrationExtensionTokenPayload, 'iat' | 'exp'>,
      { expiresIn },
    );
    const decoded = this.jwt.decode<IIntegrationExtensionTokenPayload>(token);
    return { token, exp: decoded?.exp ?? 0 };
  }

  @Post('import-state')
  @ApiOperation({
    summary:
      'Receive cookies harvested from the user’s own Chrome and stash them in the per-user browser-state store, creating the IntegrationAccount on the fly if it doesn’t exist. Authentication: Bearer <ext-token> minted via /integrations/extension/token.',
    operationId: 'importIntegrationExtensionState',
  })
  @ApiOkResponse({ type: ExtensionImportStateResponseDto })
  async importState(
    @Body() dto: ExtensionImportStateDto,
    @Headers('authorization') auth?: string,
  ): Promise<ExtensionImportStateResponseDto> {
    const token = this.parseBearer(auth);
    const payload = this.verifyExtensionToken(token);

    const account = await this.service.connectAndImport(
      payload.sub,
      dto.service,
      dto.accountKey,
      dto.cookies,
      dto.origins as never,
      dto.userAgent,
    );

    return {
      ok: true,
      accountId: account.id,
      service: account.service,
      accountKey: account.accountKey,
      cookies: dto.cookies.length,
    };
  }

  @Get('download')
  @ApiOperation({
    summary:
      'Download the Ranch Cookies Chrome extension as a zip — load it unpacked in chrome://extensions/. Path source: EXTENSION_DIR env var, falls back to ranch-repo-root/extension/.',
    operationId: 'downloadIntegrationExtension',
  })
  async download(@Res() res: Response): Promise<void> {
    const dir =
      process.env.EXTENSION_DIR ??
      path.resolve(process.cwd(), '..', 'extension');

    if (!existsSync(path.join(dir, 'manifest.json'))) {
      throw new NotFoundException(
        `Extension files not found at ${dir}. Set EXTENSION_DIR to the folder that contains manifest.json (typically ranch/extension/).`,
      );
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="ranch-cookies-extension.zip"',
    );

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => {
      this.logger.error(`archive failed: ${err.message}`);
      // Already wrote headers — best we can do is end the response.
      if (!res.headersSent) res.status(500);
      res.end();
    });
    archive.pipe(res);
    // The `false` collapses the source dir into the zip root so users
    // can load the unzipped folder directly without an extra nested
    // directory step.
    archive.directory(dir, false);
    await archive.finalize();
  }

  private parseBearer(header: string | undefined): string {
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Bearer token required');
    }
    return header.slice('Bearer '.length).trim();
  }

  private verifyExtensionToken(
    token: string,
  ): IIntegrationExtensionTokenPayload {
    let payload: IIntegrationExtensionTokenPayload;
    try {
      payload = this.jwt.verify<IIntegrationExtensionTokenPayload>(token);
    } catch (err) {
      this.logger.warn(`Extension token rejected: ${(err as Error).message}`);
      throw new UnauthorizedException('Invalid extension token');
    }
    if (payload.scope !== 'integration:cookies') {
      throw new UnauthorizedException(
        'Token scope mismatch — expected integration:cookies',
      );
    }
    if (!payload.sub) {
      throw new UnauthorizedException('Token missing required sub claim');
    }
    return payload;
  }
}
