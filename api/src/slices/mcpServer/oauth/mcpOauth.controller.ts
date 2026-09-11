import { randomBytes } from 'crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  Logger,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '#/user/auth/guards';
import { BridleApiKeyGuard } from '#/bridle/guards/bridleApiKey.guard';
import { callbackPageCsp, renderCallbackPage } from './callbackPage';
import { McpOauthService } from './domain/mcpOauth.service';
import {
  McpOauthStatusDto,
  StartMcpOauthDto,
  StartMcpOauthResultDto,
} from './dtos/startMcpOauth.dto';

/**
 * In-chat OAuth "Connect" flow for OAuth-based MCP servers (CLEAN-75). `start`
 * and `status` are called by the agent runtime (x-bridle-api-key, the same auth
 * it uses for every other ranch call); `callback` is hit by the user's browser
 * after they log in at the provider — it carries no key, only the opaque
 * `state` we minted, so it is @Public.
 */
@ApiTags('mcp-oauth')
@Controller('mcp-servers/:serverId/oauth')
export class McpOauthController {
  private readonly logger = new Logger(McpOauthController.name);

  constructor(private readonly service: McpOauthService) {}

  @Post('start')
  @UseGuards(BridleApiKeyGuard)
  @ApiHeader({ name: 'x-bridle-api-key', required: true })
  @ApiOperation({
    operationId: 'startMcpOauth',
    summary:
      'Begin an OAuth connect for an agent. Returns the authorization URL the agent sends the user in chat.',
  })
  @ApiOkResponse({ type: StartMcpOauthResultDto })
  async start(
    @Param('serverId') serverId: string,
    @Body() dto: StartMcpOauthDto,
  ): Promise<StartMcpOauthResultDto> {
    return this.service.start(serverId, dto.agentId);
  }

  @Get('callback')
  @Public()
  @ApiOperation({
    operationId: 'mcpOauthCallback',
    summary:
      'OAuth redirect target. Exchanges the code, stores the per-agent token, wakes the agent, and shows a return-to-chat page.',
  })
  async callback(
    @Param('serverId') serverId: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ): Promise<void> {
    let heading = 'Connected ✅';
    let sub = 'You can return to the chat.';
    try {
      if (!code || !state) {
        throw new BadRequestException('Missing code or state');
      }
      const { serverName } = await this.service.handleCallback(
        serverId,
        state,
        code,
      );
      heading = `Connected to ${serverName} ✅`;
    } catch (err) {
      heading = 'Connection failed';
      // Only our own, deliberately worded rejections reach the person
      // ("handshake expired — start again"). Anything else — a provider's
      // token endpoint echoing its body, a network error — is logged here
      // and shown as a generic hint: it is not ours to relay, and it may
      // contain whatever the provider chose to put there.
      sub =
        err instanceof HttpException
          ? err.message
          : 'Please try connecting again from the chat.';
      this.logger.warn(
        `OAuth callback failed (serverId=${serverId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      res.status(400);
    }
    // The server name and the error text are provider-chosen; the page
    // escapes both, and the CSP admits only its own nonce-tagged script so
    // nothing that slipped through could run anyway.
    const nonce = randomBytes(16).toString('base64');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', callbackPageCsp(nonce));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.send(renderCallbackPage({ heading, sub, nonce }));
  }

  @Get('status')
  @UseGuards(BridleApiKeyGuard)
  @ApiHeader({ name: 'x-bridle-api-key', required: true })
  @ApiOperation({
    operationId: 'mcpOauthStatus',
    summary: 'Whether the given agent already has a usable token for this server.',
  })
  @ApiOkResponse({ type: McpOauthStatusDto })
  async status(
    @Param('serverId') serverId: string,
    @Query('agentId') agentId: string,
  ): Promise<McpOauthStatusDto> {
    return this.service.status(serverId, agentId);
  }
}
