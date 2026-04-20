import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  Param,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiOkResponse } from '@nestjs/swagger';
import { IBridleGateway, buildParts } from './domain';
import { SendMessageDto, BridleHealthDto, BridleBotHealthDto } from './dtos';
import { FlatResponse } from './core';

@ApiTags('bridle')
@Controller('api/agent')
export class BridleController {
  constructor(private readonly hub: IBridleGateway) {}

  @ApiOperation({
    description:
      'Send a message to a bot agent (HTTP fallback — fire & forget)',
    operationId: 'sendBridleMessage',
  })
  @ApiBody({ type: SendMessageDto })
  @FlatResponse()
  @Post(':botId/message')
  @HttpCode(200)
  async sendMessage(
    @Param('botId') botId: string,
    @Req() req: Record<string, unknown>,
    @Body() body: SendMessageDto,
  ) {
    const user = req.user as Record<string, unknown> | undefined;
    const clientId = (user?.id as string) ?? 'http-' + crypto.randomUUID();
    const parts = body.parts ?? buildParts(body.text, body.images);
    this.hub.sendToAgent(clientId, botId, body.text, parts);
    return { ok: true };
  }

  @ApiOperation({
    description:
      'Send a message and wait for the bot agent response (synchronous)',
    operationId: 'sendBridleMessageSync',
  })
  @ApiBody({ type: SendMessageDto })
  @FlatResponse()
  @Post(':botId/message/sync')
  @HttpCode(200)
  async sendMessageSync(
    @Param('botId') botId: string,
    @Req() req: Record<string, unknown>,
    @Body() body: SendMessageDto,
  ) {
    const clientId = 'sync-' + crypto.randomUUID();
    const chunks: string[] = [];

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.hub.unregisterClient(clientId);
        resolve({
          text: chunks.join('') || 'Timeout: no response from agent',
          messageId: '',
          ts: Date.now(),
        });
      }, 120_000);

      this.hub.registerClient(clientId, botId, (data: unknown) => {
        const event = data as Record<string, unknown>;
        if (event.type === 'message' || event.type === 'stream_end') {
          clearTimeout(timeout);
          this.hub.unregisterClient(clientId);
          resolve({
            text: event.text ?? chunks.join(''),
            messageId: event.messageId,
            ts: event.ts,
          });
        } else if (event.type === 'stream') {
          chunks.push((event.text as string) ?? '');
        }
      });

      const parts = body.parts ?? buildParts(body.text, body.images);
      this.hub.sendToAgent(clientId, botId, body.text, parts);
    });
  }

  @ApiOperation({
    description: 'Check overall hub status',
    operationId: 'bridleHealth',
  })
  @FlatResponse()
  @ApiOkResponse({ type: BridleHealthDto })
  @Get('health')
  async health() {
    return this.hub.health();
  }

  @ApiOperation({
    description: 'Check bot agent connection status',
    operationId: 'bridleBotHealth',
  })
  @FlatResponse()
  @ApiOkResponse({ type: BridleBotHealthDto })
  @Get(':botId/health')
  async botHealth(@Param('botId') botId: string) {
    return this.hub.botHealth(botId);
  }

  @ApiOperation({
    description: 'List all connected agents',
    operationId: 'listAgents',
  })
  @FlatResponse()
  @Get('list')
  async listAgents() {
    return this.hub.listAgents();
  }
}
