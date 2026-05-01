import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  HttpCode,
  Inject,
  Param,
  Query,
  Req,
  Logger,
  forwardRef,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiOkResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { IBridleGateway, buildParts } from './domain';
import {
  SendMessageDto,
  BridleHealthDto,
  BridleBotHealthDto,
  TranscriptResponseDto,
  TranscriptMessageDto,
} from './dtos';
import { FlatResponse } from './core';
import { IFileGateway } from '#/agent/file/domain';

@ApiTags('bridle')
@Controller('api/agent')
export class BridleController {
  private readonly logger = new Logger(BridleController.name);

  constructor(
    private readonly hub: IBridleGateway,
    @Inject(forwardRef(() => IFileGateway))
    private readonly fileGateway: IFileGateway,
  ) {}

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

      this.hub.registerClient(
        clientId,
        botId,
        (data: unknown) => {
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
        },
        false,
      );

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

  @ApiOperation({
    description:
      'Replay the persisted chat transcript for a bot (read from the agent runtime\'s data/sessions/bridle:<channel>.jsonl). Used to restore the chat UI on page refresh — live updates still arrive via /ws/chat.',
    operationId: 'getBridleTranscript',
  })
  @ApiQuery({
    name: 'channel',
    required: false,
    description: 'Session channel — defaults to "admin" for the admin app.',
  })
  @FlatResponse()
  @ApiOkResponse({ type: TranscriptResponseDto })
  @Get(':botId/transcript')
  async transcript(
    @Param('botId') botId: string,
    @Query('channel') channelRaw?: string,
  ): Promise<TranscriptResponseDto> {
    const channel = (channelRaw ?? 'admin').trim() || 'admin';
    const path = `data/sessions/bridle:${channel}.jsonl`;

    let content: string;
    try {
      const file = await this.fileGateway.read(botId, path);
      content = file.content;
    } catch (err) {
      const status = (err as { status?: number; statusCode?: number }).status;
      if (status === 404) return { messages: [], channel };
      this.logger.warn(
        `Transcript read failed for ${botId}/${channel}: ${(err as Error).message}`,
      );
      return { messages: [], channel };
    }

    const messages: TranscriptMessageDto[] = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const evt = JSON.parse(trimmed) as {
          id?: string;
          type?: string;
          ts?: number;
          data?: { text?: string };
        };
        if (evt.type !== 'user' && evt.type !== 'assistant') continue;
        const text = evt.data?.text;
        if (!text || !evt.id || typeof evt.ts !== 'number') continue;
        messages.push({ id: evt.id, role: evt.type, text, ts: evt.ts });
      } catch {
        // Skip malformed lines — JSONL writers occasionally truncate the
        // tail mid-flush; one bad line shouldn't kill the whole replay.
      }
    }

    messages.sort((a, b) => a.ts - b.ts);
    return { messages, channel };
  }

  @ApiOperation({
    description:
      'Delete the persisted chat transcript for a bot/channel. Used to start a fresh chat — UI clears, refresh shows empty. Note: the agent runtime\'s in-memory session may still hold context until the next pod restart.',
    operationId: 'resetBridleTranscript',
  })
  @ApiQuery({
    name: 'channel',
    required: false,
    description: 'Session channel — defaults to "admin".',
  })
  @FlatResponse()
  @Delete(':botId/transcript')
  @HttpCode(204)
  async resetTranscript(
    @Param('botId') botId: string,
    @Query('channel') channelRaw?: string,
  ): Promise<void> {
    const channel = (channelRaw ?? 'admin').trim() || 'admin';
    const path = `data/sessions/bridle:${channel}.jsonl`;
    try {
      await this.fileGateway.delete(botId, path);
    } catch (err) {
      this.logger.warn(
        `Transcript reset failed for ${botId}/${channel}: ${(err as Error).message}`,
      );
    }
  }
}
