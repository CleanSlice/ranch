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
  BridleAgentHealthDto,
  TranscriptQueryDto,
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
    description: 'Send a message to a agent (HTTP fallback — fire & forget)',
    operationId: 'sendBridleMessage',
  })
  @ApiBody({ type: SendMessageDto })
  @FlatResponse()
  @Post(':agentId/message')
  @HttpCode(200)
  async sendMessage(
    @Param('agentId') agentId: string,
    @Req() req: Record<string, unknown>,
    @Body() body: SendMessageDto,
  ) {
    const user = req.user as Record<string, unknown> | undefined;
    const clientId = (user?.id as string) ?? 'http-' + crypto.randomUUID();
    const parts = body.parts ?? buildParts(body.text, body.images);
    this.hub.sendToAgent(clientId, agentId, body.text, parts, body.forceRlm);
    return { ok: true };
  }

  @ApiOperation({
    description: 'Send a message and wait for the agent response (synchronous)',
    operationId: 'sendBridleMessageSync',
  })
  @ApiBody({ type: SendMessageDto })
  @FlatResponse()
  @Post(':agentId/message/sync')
  @HttpCode(200)
  async sendMessageSync(
    @Param('agentId') agentId: string,
    @Req() req: Record<string, unknown>,
    @Body() body: SendMessageDto,
  ) {
    const clientId = 'sync-' + crypto.randomUUID();
    const chunks: string[] = [];

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.hub.unregisterClient(clientId, agentId);
        resolve({
          text: chunks.join('') || 'Timeout: no response from agent',
          messageId: '',
          ts: Date.now(),
        });
      }, 120_000);

      this.hub.registerClient(
        clientId,
        agentId,
        (data: unknown) => {
          const event = data as Record<string, unknown>;
          if (event.type === 'message' || event.type === 'stream_end') {
            clearTimeout(timeout);
            this.hub.unregisterClient(clientId, agentId);
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
      this.hub.sendToAgent(clientId, agentId, body.text, parts, body.forceRlm);
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
    description: 'Check agent connection status',
    operationId: 'bridleAgentHealth',
  })
  @FlatResponse()
  @ApiOkResponse({ type: BridleAgentHealthDto })
  @Get(':agentId/health')
  async agentHealth(@Param('agentId') agentId: string) {
    return this.hub.agentHealth(agentId);
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
      "Replay the persisted chat transcript for an agent (read from the agent runtime's data/sessions/bridle:<channel>.jsonl). Paginated tail-first: omit `cursor` for the latest `limit` messages; pass the returned `nextCursor` to fetch older pages. Live updates still arrive via /ws/client.",
    operationId: 'getBridleTranscript',
  })
  @FlatResponse()
  @ApiOkResponse({ type: TranscriptResponseDto })
  @Get(':agentId/transcript')
  async transcript(
    @Param('agentId') agentId: string,
    @Query() query: TranscriptQueryDto,
  ): Promise<TranscriptResponseDto> {
    const channel = (query.channel ?? 'admin').trim() || 'admin';
    const limit = query.limit ?? 50;
    const path = `data/sessions/bridle:${channel}.jsonl`;

    let allMessages: TranscriptMessageDto[];
    try {
      allMessages = await this.readAllTranscriptMessages(agentId, path);
    } catch (err) {
      const getStatus = (err as { getStatus?: () => number }).getStatus;
      const status =
        typeof getStatus === 'function'
          ? getStatus.call(err)
          : ((err as { status?: number; statusCode?: number }).status ??
            (err as { statusCode?: number }).statusCode);
      if (status === 404) {
        return { messages: [], channel, nextCursor: null, hasMore: false };
      }
      this.logger.warn(
        `Transcript read failed for ${agentId}/${channel}: ${(err as Error).message}`,
      );
      return { messages: [], channel, nextCursor: null, hasMore: false };
    }

    const endIdx = this.parseCursor(query.cursor, allMessages.length);
    const startIdx = Math.max(0, endIdx - limit);
    const page = allMessages.slice(startIdx, endIdx);
    const hasMore = startIdx > 0;

    return {
      messages: page,
      channel,
      nextCursor: hasMore ? String(startIdx) : null,
      hasMore,
    };
  }

  // Read the full JSONL transcript via range reads, parse all visible
  // user/assistant lines, return sorted ascending by ts. Large files are
  // streamed in 512 KB blocks so we never hit the editor's MAX_BYTES cap.
  // Hard ceiling: 20 MB to avoid pathological reads — anything bigger
  // should be exported via the Files ZIP download.
  private async readAllTranscriptMessages(
    agentId: string,
    path: string,
  ): Promise<TranscriptMessageDto[]> {
    const MAX_TRANSCRIPT_BYTES = 20 * 1024 * 1024;
    let content = '';
    let offset = 0;
    while (true) {
      const chunk = await this.fileGateway.readRange(
        agentId,
        path,
        offset,
        512 * 1024,
      );
      content += chunk.content;
      if (content.length > MAX_TRANSCRIPT_BYTES) {
        throw new Error(
          `Transcript exceeds ${MAX_TRANSCRIPT_BYTES} bytes — export via Files instead`,
        );
      }
      if (!chunk.hasMore || chunk.nextOffset === null) break;
      offset = chunk.nextOffset;
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
    return messages;
  }

  // Cursor is the index *into the sorted-ascending message list* where the
  // next page ENDS (exclusive). Default: total length (= latest page).
  private parseCursor(cursor: string | undefined, total: number): number {
    if (!cursor) return total;
    const parsed = parseInt(cursor, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return total;
    return Math.min(parsed, total);
  }

  @ApiOperation({
    description:
      "Delete the persisted chat transcript for an agent/channel. Used to start a fresh chat — UI clears, refresh shows empty. Note: the agent runtime's in-memory session may still hold context until the next pod restart.",
    operationId: 'resetBridleTranscript',
  })
  @ApiQuery({
    name: 'channel',
    required: false,
    description: 'Session channel — defaults to "admin".',
  })
  @FlatResponse()
  @Delete(':agentId/transcript')
  @HttpCode(204)
  async resetTranscript(
    @Param('agentId') agentId: string,
    @Query('channel') channelRaw?: string,
  ): Promise<void> {
    const channel = (channelRaw ?? 'admin').trim() || 'admin';
    const path = `data/sessions/bridle:${channel}.jsonl`;
    try {
      await this.fileGateway.delete(agentId, path);
    } catch (err) {
      this.logger.warn(
        `Transcript reset failed for ${agentId}/${channel}: ${(err as Error).message}`,
      );
    }
  }

  @ApiOperation({
    description:
      'Archive the persisted chat transcript for an agent/channel — the live JSONL is moved to a timestamped sibling (`bridle:<channel>.<iso-ts>.archived.jsonl`) and the live slot starts empty. Used by the embed\'s "New chat" action when the visitor wants a clean slate but we still want the prior conversation for admin/audit. No-op (returns `{}`) when there\'s nothing to archive.',
    operationId: 'archiveBridleTranscript',
  })
  @ApiQuery({
    name: 'channel',
    required: false,
    description: 'Session channel — defaults to "admin".',
  })
  @FlatResponse()
  @Post(':agentId/transcript/archive')
  @HttpCode(200)
  async archiveTranscript(
    @Param('agentId') agentId: string,
    @Query('channel') channelRaw?: string,
  ): Promise<{ archivedPath?: string }> {
    const channel = (channelRaw ?? 'admin').trim() || 'admin';
    const livePath = `data/sessions/bridle:${channel}.jsonl`;

    // Read current — NotFound is expected (nothing to archive yet);
    // everything else we want to see in logs so a silent {} doesn't
    // mask a real bug. Same treatment downstream.
    let content: string | undefined;
    try {
      const current = await this.fileGateway.read(agentId, livePath);
      content = current.content;
    } catch (err) {
      const e = err as { status?: number; message?: string };
      // NestJS NotFoundException carries .status = 404
      if (e?.status === 404) {
        this.logger.log(
          `Transcript archive: nothing to archive (${agentId}/${channel})`,
        );
        return {};
      }
      this.logger.warn(
        `Transcript archive read failed for ${agentId}/${channel}: ${e?.message ?? String(err)}`,
      );
      throw err;
    }

    if (!content || !content.trim()) {
      this.logger.log(
        `Transcript archive: empty content (${agentId}/${channel})`,
      );
      return {};
    }

    // Timestamp suffix friendly to filesystems that disallow ':' in
    // names. Date.now() is fine here — request-time code, not a
    // workflow script.
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const archivedPath = `data/sessions/bridle:${channel}.${ts}.archived.jsonl`;

    try {
      // saveRaw bypasses the .md/.json editable-extension guard — that
      // guard is for the user-facing file editor, not for internal
      // controllers archiving a .jsonl transcript.
      await this.fileGateway.saveRaw(agentId, archivedPath, content);
    } catch (err) {
      this.logger.warn(
        `Transcript archive save failed for ${agentId}/${channel} → ${archivedPath}: ${(err as Error).message}`,
      );
      throw err;
    }

    try {
      // Now that the archive exists, drop the live file. If this step
      // fails, both files exist briefly — recoverable by replaying the
      // archived copy; preferable to having neither.
      await this.fileGateway.delete(agentId, livePath);
    } catch (err) {
      this.logger.warn(
        `Transcript archive delete-live failed for ${agentId}/${channel}: ${(err as Error).message} — archive still at ${archivedPath}`,
      );
      throw err;
    }

    this.logger.log(
      `Transcript archived for ${agentId}/${channel} → ${archivedPath} (${content.length} bytes)`,
    );
    return { archivedPath };
  }
}
