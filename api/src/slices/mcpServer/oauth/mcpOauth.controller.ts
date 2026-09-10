import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { JwtAuthGuard, Public } from '#/user/auth/guards';
import type { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import { McpOauthService } from './domain/mcpOauth.service';
import {
  McpOauthStatusDto,
  StartMcpOauthDto,
  StartMcpOauthResultDto,
} from './dtos/startMcpOauth.dto';

/**
 * In-chat OAuth "Connect" flow for OAuth-based MCP servers (CLEAN-75). `start`
 * and `status` are called by the agent runtime / console (Bearer JWT);
 * `callback` is hit by the user's browser after they log in at the provider —
 * it carries no bearer, only the opaque `state` we minted, so it is @Public.
 */
@ApiTags('mcp-oauth')
@Controller('mcp-servers/:serverId/oauth')
export class McpOauthController {
  constructor(private readonly service: McpOauthService) {}

  @Post('start')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    operationId: 'startMcpOauth',
    summary:
      'Begin an OAuth connect for an agent. Returns the authorization URL the agent sends the user in chat. Agent-issued tokens (sub=agent:<id>) may only start for themselves.',
  })
  @ApiOkResponse({ type: StartMcpOauthResultDto })
  async start(
    @Param('serverId') serverId: string,
    @Body() dto: StartMcpOauthDto,
    @Req() req: Request & { user?: IAuthTokenPayload },
  ): Promise<StartMcpOauthResultDto> {
    const sub = req.user?.sub ?? '';
    if (sub.startsWith('agent:') && sub !== `agent:${dto.agentId}`) {
      throw new ForbiddenException(
        'Agent tokens can only start a connect for their own agent',
      );
    }
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
      if (!code || !state) throw new Error('missing code/state');
      const { serverName } = await this.service.handleCallback(
        serverId,
        state,
        code,
      );
      heading = `Connected to ${serverName} ✅`;
    } catch (err) {
      heading = 'Connection failed';
      sub = (err as Error).message || 'Please try connecting again from the chat.';
      res.status(400);
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(
      `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<body style="font-family:system-ui;display:grid;place-items:center;height:90vh;margin:0;color:#111">` +
        `<div style="text-align:center;max-width:32rem;padding:1.5rem">` +
        `<h2 style="margin:.2rem 0">${heading}</h2>` +
        `<p style="color:#555">${sub}</p>` +
        `<script>setTimeout(()=>window.close(),1500)</script></div></body>`,
    );
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
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
