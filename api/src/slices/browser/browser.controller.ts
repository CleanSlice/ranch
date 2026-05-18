import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { IBrowserGateway } from './domain';
import {
  BrowserSessionConnectionDto,
  BrowserSessionDto,
  OpenSessionDto,
  SetStatusDto,
} from './dtos';
import { IAuthTokenPayload } from '../user/auth/domain/auth.types';
import { JwtAuthGuard } from '../user/auth/guards';

@ApiTags('browser')
@ApiBearerAuth()
@Controller('browser/sessions')
@UseGuards(JwtAuthGuard)
export class BrowserController {
  constructor(private readonly gateway: IBrowserGateway) {}

  @Get()
  @ApiOperation({
    summary: 'List the calling user’s browser sessions.',
    operationId: 'listBrowserSessions',
  })
  @ApiOkResponse({ type: [BrowserSessionDto] })
  async list(
    @Req() req: Request & { user: IAuthTokenPayload },
  ): Promise<BrowserSessionDto[]> {
    return (await this.gateway.findAll({
      userId: req.user.sub,
    })) as BrowserSessionDto[];
  }

  @Post()
  @ApiOperation({
    summary:
      'Open or reuse a browser session for the given accountKey. Returns a CDP URL the runtime uses to connect a Playwright/CDP client.',
    operationId: 'openBrowserSession',
  })
  @ApiOkResponse({ type: BrowserSessionConnectionDto })
  async open(
    @Body() dto: OpenSessionDto,
    @Req() req: Request & { user: IAuthTokenPayload },
  ): Promise<BrowserSessionConnectionDto> {
    return (await this.gateway.openSession(
      req.user.sub,
      dto.accountKey,
      dto.loginUrl,
    )) as BrowserSessionConnectionDto;
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a single session (only sessions you own).',
    operationId: 'getBrowserSession',
  })
  @ApiOkResponse({ type: BrowserSessionDto })
  async get(
    @Param('id') id: string,
    @Req() req: Request & { user: IAuthTokenPayload },
  ): Promise<BrowserSessionDto | null> {
    return (await this.gateway.findById(
      req.user.sub,
      id,
    )) as BrowserSessionDto | null;
  }

  @Post(':id/reset')
  @ApiOperation({
    summary:
      'Discard the current browser instance for this session and return a fresh CDP URL. Use when a browser_play call has been stuck on a 120s timeout.',
    operationId: 'resetBrowserSession',
  })
  @ApiOkResponse({ type: BrowserSessionConnectionDto })
  async reset(
    @Param('id') id: string,
    @Req() req: Request & { user: IAuthTokenPayload },
  ): Promise<BrowserSessionConnectionDto> {
    return (await this.gateway.resetSession(
      req.user.sub,
      id,
    )) as BrowserSessionConnectionDto;
  }

  @Post(':id/status')
  @ApiOperation({
    summary:
      'Update session status. Called by the runtime after each tool batch (idle / needs_login / stuck), or by the admin UI to mark a session for relogin.',
    operationId: 'setBrowserSessionStatus',
  })
  @ApiOkResponse({ type: BrowserSessionDto })
  async setStatus(
    @Param('id') id: string,
    @Body() dto: SetStatusDto,
    @Req() req: Request & { user: IAuthTokenPayload },
  ): Promise<BrowserSessionDto> {
    return (await this.gateway.setStatus(
      req.user.sub,
      id,
      dto.status,
    )) as BrowserSessionDto;
  }

  @Post(':id/vnc-url')
  @ApiOperation({
    summary:
      'Mint a short-lived (15 min) VNC URL the end user can open to finish a 2FA/CAPTCHA flow manually.',
    operationId: 'mintBrowserSessionVncUrl',
  })
  async vncUrl(
    @Param('id') id: string,
    @Req() req: Request & { user: IAuthTokenPayload },
  ): Promise<{ vncUrl: string | null }> {
    return { vncUrl: await this.gateway.mintVncUrl(req.user.sub, id) };
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Disconnect the account — drops the session row and schedules the profile directory for cleanup.',
    operationId: 'deleteBrowserSession',
  })
  async remove(
    @Param('id') id: string,
    @Req() req: Request & { user: IAuthTokenPayload },
  ): Promise<void> {
    await this.gateway.deleteSession(req.user.sub, id);
  }
}
