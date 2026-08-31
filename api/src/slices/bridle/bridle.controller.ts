import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  BadRequestException,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
  Logger,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  forwardRef,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import {
  IBridleGateway,
  IBridleAttachmentGateway,
  BridleAttachmentService,
  MAX_ATTACHMENT_BYTES,
  buildParts,
} from './domain';
import {
  SendMessageDto,
  BridleHealthDto,
  BridleAgentHealthDto,
  BridleAttachmentDto,
  TranscriptQueryDto,
  TranscriptResponseDto,
  TranscriptMessageDto,
} from './dtos';
import { FlatResponse } from './core';
import { JwtAuthGuard } from '#/user/auth/guards';
import {
  IFileGateway,
  TranscriptReaderService,
  TranscriptMessage,
} from '#/agent/file/domain';

/** Shape multer gives us. Mirrors the local interface in reins/source. */
interface IUploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Strip anything that could break out of the quoted `filename=` parameter or
 * smuggle a header. Display-only — the stored object's key never contains any
 * part of the user-supplied name.
 */
function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'attachment';
}

@ApiTags('bridle')
@Controller('api/agent')
export class BridleController {
  private readonly logger = new Logger(BridleController.name);

  constructor(
    private readonly hub: IBridleGateway,
    private readonly jwt: JwtService,
    @Inject(forwardRef(() => IFileGateway))
    private readonly fileGateway: IFileGateway,
    @Inject(forwardRef(() => TranscriptReaderService))
    private readonly transcriptReader: TranscriptReaderService,
    private readonly attachments: BridleAttachmentService,
    private readonly attachmentGateway: IBridleAttachmentGateway,
  ) {}

  /**
   * Resolve a STABLE client identity for HTTP chat calls, the same way the WS
   * client handler does: verify the Bearer JWT the app already sends and use its
   * `sub` (or `admin` for owners/admins). A stable id is essential — the agent
   * runtime keys access-approval AND session history on this id, so a fresh id
   * per request re-triggers the "send the owner your code" flow on every message
   * and scatters history across throwaway channels. Returns null for anonymous
   * callers (no/invalid token) → the caller mints a per-request throwaway id.
   */
  private resolveClientId(req: Record<string, unknown>): string | null {
    const headers = req.headers as Record<string, string | undefined>;
    const [scheme, token] = (headers?.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
    try {
      const payload = this.jwt.verify<Record<string, unknown>>(token);
      const roles = payload.roles as string[] | undefined;
      const isAdmin =
        Array.isArray(roles) &&
        (roles.includes('Owner') || roles.includes('Admin'));
      return isAdmin ? 'admin' : ((payload.sub as string) ?? null);
    } catch {
      return null;
    }
  }

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
    const clientId = this.resolveClientId(req) ?? 'http-' + crypto.randomUUID();
    const base = body.parts ?? buildParts(body.text, body.images);
    const expanded = await this.attachments.expand(
      agentId,
      body.text,
      body.attachmentIds,
    );
    this.hub.sendToAgent(clientId, agentId, expanded.text, [
      ...base,
      ...expanded.parts,
    ]);
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
    const clientId = this.resolveClientId(req) ?? 'sync-' + crypto.randomUUID();
    // Distinct from clientId: this HTTP call shares the clientId+agentId map
    // key with any concurrently-open WS session for the same visitor (e.g.
    // the chat widget open in another tab), so registerClient/unregisterClient
    // need their own socket-equivalent identity to avoid one call's cleanup
    // wiping the other's live registration.
    const socketId = 'sync-' + crypto.randomUUID();
    const chunks: string[] = [];

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.hub.unregisterClient(clientId, agentId, socketId);
        resolve({
          text: chunks.join('') || 'Timeout: no response from agent',
          messageId: '',
          ts: Date.now(),
        });
      }, 120_000);

      this.hub.registerClient(
        clientId,
        agentId,
        socketId,
        (data: unknown) => {
          const event = data as Record<string, unknown>;
          if (event.type === 'message' || event.type === 'stream_end') {
            clearTimeout(timeout);
            this.hub.unregisterClient(clientId, agentId, socketId);
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

      const base = body.parts ?? buildParts(body.text, body.images);
      // Expanding before the send keeps the failure ordering sane: a bad or
      // missing attachment rejects the request instead of leaving the caller
      // waiting out the 120s timeout for a message the agent never got.
      this.attachments
        .expand(agentId, body.text, body.attachmentIds)
        .then((expanded) => {
          this.hub.sendToAgent(clientId, agentId, expanded.text, [
            ...base,
            ...expanded.parts,
          ]);
        })
        .catch((err: Error) => {
          clearTimeout(timeout);
          this.hub.unregisterClient(clientId, agentId);
          reject(err);
        });
    });
  }

  /**
   * Upload one attachment for a later message.
   *
   * `JwtAuthGuard` is declared explicitly here, and it matters: it is NOT a
   * global guard in this API, and the rest of this controller is deliberately
   * unguarded so the embeddable widget's anonymous visitors can reach the hub.
   * A route added here without the guard would publish every uploaded file to
   * anyone who asks.
   *
   * One file per request rather than a batch, so each attachment reports its
   * own progress and its own failure in the compose area.
   */
  @ApiOperation({
    description:
      'Upload a chat attachment. Returns the id the send call references ' +
      'via `attachmentIds`. Requires a bearer token.',
    operationId: 'uploadBridleAttachment',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ type: BridleAttachmentDto })
  @FlatResponse()
  @UseGuards(JwtAuthGuard)
  @Post(':agentId/attachment')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }),
  )
  async uploadAttachment(
    @Param('agentId') agentId: string,
    @UploadedFile() file?: IUploadedFile,
  ): Promise<BridleAttachmentDto> {
    if (!file) {
      throw new BadRequestException('A file is required (field "file")');
    }
    return this.attachments.upload({
      agentId,
      name: file.originalname,
      mimeType: file.mimetype,
      body: file.buffer,
    });
  }

  /**
   * Serve an attachment back to the browser.
   *
   * `@Res()` bypasses the global `{ success, data }` envelope so the raw bytes
   * go out with their own headers — the same pattern as the chat, template and
   * agent-file exports. Guarded for the same reason as the upload above.
   */
  @ApiOperation({
    description:
      'Download a chat attachment. Streams the stored bytes with their ' +
      'original content type. Requires a bearer token.',
    operationId: 'getBridleAttachment',
  })
  @UseGuards(JwtAuthGuard)
  @Get(':agentId/attachment/:attachmentId')
  async downloadAttachment(
    @Param('agentId') agentId: string,
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const stored = await this.attachmentGateway.fetch(agentId, attachmentId);
    if (!stored) {
      // The UI renders this as an explicit "no longer available" state rather
      // than a broken image.
      throw new NotFoundException(`Attachment ${attachmentId} not found`);
    }

    res.setHeader('Content-Type', stored.mimeType);
    res.setHeader('Content-Length', stored.size);
    // `inline` so images render in a bubble and PDFs open in the viewer; the
    // browser still offers "save as". `private` keeps it out of shared caches.
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${sanitizeFilename(stored.name)}"`,
    );
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(stored.body);
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

    let all: TranscriptMessage[];
    try {
      // Byte-identical to the previous inline reader: user/assistant only, raw
      // order (no transient filtering). The admin chat-history view uses the
      // same service but opts into summaries + hygiene.
      all = await this.transcriptReader.read(agentId, path, {
        types: ['user', 'assistant'],
        filterTransient: false,
      });
    } catch (err) {
      const getStatus = (err as { getStatus?: () => number }).getStatus;
      const status =
        typeof getStatus === 'function'
          ? getStatus.call(err)
          : ((err as { status?: number; statusCode?: number }).status ??
            (err as { statusCode?: number }).statusCode);
      if (status !== 404) {
        this.logger.warn(
          `Transcript read failed for ${agentId}/${channel}: ${(err as Error).message}`,
        );
      }
      return { messages: [], channel, nextCursor: null, hasMore: false };
    }

    const { messages, nextCursor, hasMore } = TranscriptReaderService.page(
      all,
      query.cursor,
      limit,
    );
    return {
      messages: messages as TranscriptMessageDto[],
      channel,
      nextCursor,
      hasMore,
    };
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
      return;
    }
    // Tell the live agent to drop its own local/in-memory copy too — S3FileGateway
    // only touched the S3 mirror, and the running pod would otherwise re-upload
    // its still-intact local session file on the next local change.
    this.hub.clearAgentSession(agentId, channel);
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
    // Tell the live agent to drop its own local/in-memory copy too — the
    // fileGateway calls above only touched the S3 mirror, and the running
    // pod would otherwise re-upload its still-intact local session file on
    // the next local change, resurrecting the history we just archived.
    this.hub.clearAgentSession(agentId, channel);
    return { archivedPath };
  }
}
