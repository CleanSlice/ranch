import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  BadRequestException,
  ForbiddenException,
  HttpCode,
  Inject,
  NotFoundException,
  UnauthorizedException,
  Param,
  Query,
  Req,
  Res,
  Logger,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  applyDecorators,
  forwardRef,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import {
  IBridleGateway,
  BridleAttachmentService,
  MAX_ATTACHMENT_BYTES,
  buildParts,
  clientIdFromJwtPayload,
  hasShareToken,
  parseBearer,
  resolveShareIdentity,
} from './domain';
import type { ChatHeaders, IAttachmentRequester, IChatAuth } from './domain';
import {
  AuthErrorCodes,
  classifyJwtError,
  unauthorized,
} from '#/user/auth/domain/auth.types';
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
import { BridleChatAuthGuard } from './guards/bridleChatAuth.guard';
import type { IChatAuthRequest } from './guards/bridleChatAuth.guard';
import {
  IFileGateway,
  TranscriptReaderService,
  TranscriptMessage,
} from '#/agent/file/domain';
import {
  SHARE_CLIENT_PREFIX,
  ShareLinkErrorCodes,
  ShareLinkService,
} from '#/agent/shareLink/domain';

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

/**
 * The share-link header pair (CLEAN-66), documented on every chat route that
 * accepts it. Both are `required: false` on purpose: the same routes serve
 * console users on a Bearer token and — for the message routes — anonymous
 * embed visitors on no credential at all, so making either header mandatory
 * in the spec would be a lie AND would force it onto every generated client
 * call. They are only meaningful together.
 */
const ApiShareHeaders = () =>
  applyDecorators(
    ApiHeader({
      name: 'X-Share-Token',
      required: false,
      description:
        'Share-link token (`sl_…`) identifying a public share visitor. Send ' +
        'together with `X-Share-Visitor` instead of an `Authorization` ' +
        'bearer. Re-validated against the agent in the path on every ' +
        'request, so a revoked link stops working immediately.',
    }),
    ApiHeader({
      name: 'X-Share-Visitor',
      required: false,
      description:
        'Opaque per-browser visitor id minted by the share page. Required ' +
        "whenever `X-Share-Token` is sent; it selects the visitor's own " +
        '`share-<visitorId>` chat channel and owns their attachments.',
    }),
  );

/**
 * 401 body for a bearer that was offered but cannot be used (CLEAN-72). A
 * request with no credentials at all is NOT rejected here — it stays the
 * anonymous embed visitor.
 */
const BEARER_UNAUTHORIZED_DESCRIPTION =
  'A bearer token was offered but is expired or invalid, and no share ' +
  "headers were present. Body is `{ code: 'TOKEN_EXPIRED' | " +
  "'TOKEN_INVALID', message }` — the console renews via POST /auth/refresh " +
  'and retries once. Requests with no credentials stay anonymous.';

/** 403 body shared by every share-link rejection. */
const SHARE_FORBIDDEN_DESCRIPTION =
  'Share headers were offered but rejected — revoked, unknown or ' +
  'foreign-agent token, or a malformed visitor id. Body is `{ code: ' +
  "'SHARE_LINK_INVALID' }` or `{ code: 'SHARE_VISITOR_INVALID' }`. Never " +
  '401: a share visitor has no account to log in to.';

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
    private readonly shareLinks: ShareLinkService,
  ) {}

  /**
   * Resolve a STABLE client identity for HTTP chat calls, the same way the WS
   * client handler does: verify the Bearer JWT the app already sends and use its
   * `sub` (or `admin` for owners/admins). A stable id is essential — the agent
   * runtime keys access-approval AND session history on this id, so a fresh id
   * per request re-triggers the "send the owner your code" flow on every message
   * and scatters history across throwaway channels. Anonymous callers (no
   * token at all) come back as `{ clientId: null, kind: 'anonymous' }` and the
   * caller mints a per-request throwaway id.
   *
   * A bearer that IS offered but cannot be used (expired, forged, no usable
   * subject) is a 401 `{ code }` — never a silent demotion to anonymous: the
   * person would keep chatting as a stranger with no history (CLEAN-72). The
   * one exception mirrors `BridleChatAuthGuard`: when share headers ride along,
   * the dead console token is ignored and the share branch decides.
   *
   * A share-link visitor is identified instead by the `X-Share-Token` +
   * `X-Share-Visitor` pair, re-validated against this `agentId` on every single
   * request so a revoked link stops the very next message (research.md R4).
   * That branch never degrades to the anonymous fallback: once a share token is
   * offered at all — an empty header counts — a bad one is a 403 `{ code }`
   * from `authorizeChat` rather than a silent demotion to a throwaway id; the
   * visitor must be told their link died, not quietly handed a fresh
   * conversation.
   *
   * The KIND travels with the id, because callers downstream need it and must
   * never re-derive it from the shape of the string.
   */
  private async resolveRequester(
    req: Record<string, unknown>,
    agentId: string,
  ): Promise<IAttachmentRequester> {
    const headers = req.headers as ChatHeaders;

    const shareOffered = hasShareToken(headers);
    const token = parseBearer(headers);
    if (token) {
      const verified = this.verifyJwt(token);
      const identity = clientIdFromJwtPayload(verified.payload);
      if (identity) return { clientId: identity.clientId, kind: 'jwt' };
      if (!shareOffered) {
        throw unauthorized(
          verified.error
            ? classifyJwtError(verified.error)
            : AuthErrorCodes.TokenInvalid,
        );
      }
    }

    if (shareOffered) {
      const clientId = await resolveShareIdentity(
        headers,
        agentId,
        this.shareLinks,
      );
      return { clientId, kind: 'share' };
    }

    return { clientId: null, kind: 'anonymous' };
  }

  private verifyJwt(token: string): {
    payload: Record<string, unknown> | null;
    error?: unknown;
  } {
    try {
      return { payload: this.jwt.verify<Record<string, unknown>>(token) };
    } catch (error) {
      return { payload: null, error };
    }
  }

  /**
   * Gate the transcript routes on a share channel.
   *
   * `channel` is caller-chosen and these three routes are unauthenticated, so
   * once share conversations started living in `bridle:share-<visitorId>.jsonl`
   * anyone could read — or delete — a visitor's chat, attachment ids included,
   * just by naming the channel. A `share-` channel is therefore readable only
   * by a console user or by that very visitor; everyone else gets the same 403
   * whether or not the channel exists.
   *
   * Non-share channels keep today's (unauthenticated) behaviour — the broader
   * hardening of this endpoint is tracked separately (research.md R8).
   */
  private async requireChannelAccess(
    req: Record<string, unknown>,
    agentId: string,
    channel: string,
  ): Promise<void> {
    if (!channel.startsWith(SHARE_CLIENT_PREFIX)) return;

    const requester = await this.resolveRequester(req, agentId);
    if (requester.kind === 'jwt') return;
    if (requester.kind === 'share' && requester.clientId === channel) return;

    throw new ForbiddenException({ code: ShareLinkErrorCodes.LinkInvalid });
  }

  @ApiOperation({
    description:
      'Send a message to a agent (HTTP fallback — fire & forget). Accepts a ' +
      'bearer token or the share-link headers (`X-Share-Token` + ' +
      '`X-Share-Visitor`); with neither, the caller is the anonymous embed ' +
      'visitor and gets a throwaway channel.',
    operationId: 'sendBridleMessage',
  })
  @ApiBody({ type: SendMessageDto })
  @ApiShareHeaders()
  // Restated explicitly: the moment a route declares ANY @Api*Response, Nest
  // stops synthesising the default success entry, and the generated client
  // would lose its 2xx type.
  @ApiOkResponse({ description: 'Accepted and forwarded to the agent.' })
  @ApiUnauthorizedResponse({ description: BEARER_UNAUTHORIZED_DESCRIPTION })
  @ApiForbiddenResponse({ description: SHARE_FORBIDDEN_DESCRIPTION })
  @ApiBadRequestResponse({
    description:
      'An `attachmentIds` entry is unknown, unreadable or not owned by the ' +
      'caller.',
  })
  @FlatResponse()
  @Post(':agentId/message')
  @HttpCode(200)
  async sendMessage(
    @Param('agentId') agentId: string,
    @Req() req: Record<string, unknown>,
    @Body() body: SendMessageDto,
  ) {
    const requester = await this.resolveRequester(req, agentId);
    const clientId = requester.clientId ?? 'http-' + crypto.randomUUID();
    const base = body.parts ?? buildParts(body.text, body.images);
    const expanded = await this.attachments.expand(
      agentId,
      body.text,
      body.attachmentIds,
      requester,
    );
    this.hub.sendToAgent(
      clientId,
      agentId,
      expanded.text,
      [...base, ...expanded.parts],
      expanded.attachments,
    );
    return { ok: true };
  }

  @ApiOperation({
    description:
      'Send a message and wait for the agent response (synchronous). ' +
      'Accepts a bearer token or the share-link headers (`X-Share-Token` + ' +
      '`X-Share-Visitor`); with neither, the caller is the anonymous embed ' +
      'visitor and gets a throwaway channel.',
    operationId: 'sendBridleMessageSync',
  })
  @ApiBody({ type: SendMessageDto })
  @ApiShareHeaders()
  // Restated explicitly: the moment a route declares ANY @Api*Response, Nest
  // stops synthesising the default success entry, and the generated client
  // would lose its 2xx type.
  @ApiOkResponse({
    description:
      "The agent's reply (`{ text, messageId, ts }`), or a timeout notice " +
      'after 120s.',
  })
  @ApiUnauthorizedResponse({ description: BEARER_UNAUTHORIZED_DESCRIPTION })
  @ApiForbiddenResponse({ description: SHARE_FORBIDDEN_DESCRIPTION })
  @ApiBadRequestResponse({
    description:
      'An `attachmentIds` entry is unknown, unreadable or not owned by the ' +
      'caller.',
  })
  @FlatResponse()
  @Post(':agentId/message/sync')
  @HttpCode(200)
  async sendMessageSync(
    @Param('agentId') agentId: string,
    @Req() req: Record<string, unknown>,
    @Body() body: SendMessageDto,
  ) {
    const requester = await this.resolveRequester(req, agentId);
    const clientId = requester.clientId ?? 'sync-' + crypto.randomUUID();
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
        .expand(agentId, body.text, body.attachmentIds, requester)
        .then((expanded) => {
          this.hub.sendToAgent(
            clientId,
            agentId,
            expanded.text,
            [...base, ...expanded.parts],
            expanded.attachments,
          );
        })
        .catch((err: Error) => {
          clearTimeout(timeout);
          this.hub.unregisterClient(clientId, agentId, socketId);
          reject(err);
        });
    });
  }

  /**
   * Upload one attachment for a later message.
   *
   * `BridleChatAuthGuard` is declared explicitly here, and it matters: it is
   * NOT a global guard in this API, and the rest of this controller is
   * deliberately unguarded so the embeddable widget's anonymous visitors can
   * reach the hub. A route added here without the guard would publish every
   * uploaded file to anyone who asks. The guard admits the two identities chat
   * has — a console bearer token, or a share link's header pair — and leaves
   * whichever one it found on `req.chatAuth` — id AND kind together, so this
   * handler never has to guess either.
   *
   * That id is stamped onto the object as its `owner`, which is what stops one
   * share visitor from reading another's files back out (see `fetchFor`).
   *
   * One file per request rather than a batch, so each attachment reports its
   * own progress and its own failure in the compose area.
   */
  @ApiOperation({
    description:
      'Upload a chat attachment. Returns the id the send call references ' +
      'via `attachmentIds`. Requires a bearer token or the share-link ' +
      'headers (`X-Share-Token` + `X-Share-Visitor`).',
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
  @ApiShareHeaders()
  @ApiUnauthorizedResponse({
    description:
      'No usable credential: no bearer token and no share headers, or a ' +
      'bearer that fails verification with no share headers to fall back on.',
  })
  @ApiForbiddenResponse({ description: SHARE_FORBIDDEN_DESCRIPTION })
  @ApiBadRequestResponse({
    description:
      'No `file` field, an empty file, an unsupported type, or a file over ' +
      'the size limit.',
  })
  @FlatResponse()
  @UseGuards(BridleChatAuthGuard)
  @Post(':agentId/attachment')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }),
  )
  async uploadAttachment(
    @Param('agentId') agentId: string,
    @Req() req: IChatAuthRequest,
    @UploadedFile() file?: IUploadedFile,
  ): Promise<BridleAttachmentDto> {
    const auth = this.requireChatAuth(req);
    if (!file) {
      throw new BadRequestException('A file is required (field "file")');
    }
    return this.attachments.upload({
      agentId,
      name: file.originalname,
      mimeType: file.mimetype,
      body: file.buffer,
      owner: auth.clientId,
    });
  }

  /**
   * The identity `BridleChatAuthGuard` proved, or a hard 401.
   *
   * A guarded handler must never run with an absent identity: silently
   * treating that as "not a share visitor" is how an ownership check gets
   * skipped for the one caller nobody could identify.
   */
  private requireChatAuth(req: IChatAuthRequest): IChatAuth {
    if (!req.chatAuth?.clientId) {
      throw new UnauthorizedException('Missing access token');
    }
    return req.chatAuth;
  }

  /**
   * Serve an attachment back to the browser.
   *
   * `@Res()` bypasses the global `{ success, data }` envelope so the raw bytes
   * go out with their own headers — the same pattern as the chat, template and
   * agent-file exports. Guarded for the same reason as the upload above.
   *
   * Share visitors are additionally owner-checked: `fetchFor` hands back null
   * for someone else's file, which lands on the same 404 as a deleted one, so
   * a leaked id tells a visitor nothing. Console (JWT) callers keep today's
   * unrestricted read — including objects stored before `owner` existed.
   */
  @ApiOperation({
    description:
      'Download a chat attachment. Streams the stored bytes with their ' +
      'original content type. Requires a bearer token or the share-link ' +
      'headers (`X-Share-Token` + `X-Share-Visitor`); a share visitor may ' +
      'only read attachments they uploaded themselves.',
    operationId: 'getBridleAttachment',
  })
  @ApiShareHeaders()
  @ApiOkResponse({
    description:
      'The stored bytes, with the original content type and an `inline` ' +
      'Content-Disposition.',
  })
  @ApiUnauthorizedResponse({
    description:
      'No usable credential: no bearer token and no share headers, or a ' +
      'bearer that fails verification with no share headers to fall back on.',
  })
  @ApiForbiddenResponse({ description: SHARE_FORBIDDEN_DESCRIPTION })
  @ApiNotFoundResponse({
    description:
      'No such attachment — or one belonging to another share visitor, which ' +
      'answers with the same 404 so a leaked id reveals nothing.',
  })
  @UseGuards(BridleChatAuthGuard)
  @Get(':agentId/attachment/:attachmentId')
  async downloadAttachment(
    @Param('agentId') agentId: string,
    @Param('attachmentId') attachmentId: string,
    @Req() req: IChatAuthRequest,
    @Res() res: Response,
  ): Promise<void> {
    const stored = await this.attachments.fetchFor(
      agentId,
      attachmentId,
      this.requireChatAuth(req),
    );
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
      "Replay the persisted chat transcript for an agent (read from the agent runtime's data/sessions/bridle:<channel>.jsonl). Paginated tail-first: omit `cursor` for the latest `limit` messages; pass the returned `nextCursor` to fetch older pages. Live updates still arrive via /ws/client. A `share-<visitorId>` channel is restricted: only a bearer token or that visitor's own share headers are accepted (403 otherwise).",
    operationId: 'getBridleTranscript',
  })
  @ApiShareHeaders()
  @ApiForbiddenResponse({ description: SHARE_FORBIDDEN_DESCRIPTION })
  @FlatResponse()
  @ApiOkResponse({ type: TranscriptResponseDto })
  @Get(':agentId/transcript')
  async transcript(
    @Param('agentId') agentId: string,
    @Req() req: Record<string, unknown>,
    @Query() query: TranscriptQueryDto,
  ): Promise<TranscriptResponseDto> {
    const channel = (query.channel ?? 'admin').trim() || 'admin';
    await this.requireChannelAccess(req, agentId, channel);
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
      "Delete the persisted chat transcript for an agent/channel. Used to start a fresh chat — UI clears, refresh shows empty. Note: the agent runtime's in-memory session may still hold context until the next pod restart. A `share-<visitorId>` channel is restricted: only a bearer token or that visitor's own share headers are accepted (403 otherwise).",
    operationId: 'resetBridleTranscript',
  })
  @ApiQuery({
    name: 'channel',
    required: false,
    description: 'Session channel — defaults to "admin".',
  })
  @ApiShareHeaders()
  @ApiNoContentResponse({
    description: 'Transcript deleted, or there was nothing to delete.',
  })
  @ApiForbiddenResponse({ description: SHARE_FORBIDDEN_DESCRIPTION })
  @FlatResponse()
  @Delete(':agentId/transcript')
  @HttpCode(204)
  async resetTranscript(
    @Param('agentId') agentId: string,
    @Req() req: Record<string, unknown>,
    @Query('channel') channelRaw?: string,
  ): Promise<void> {
    const channel = (channelRaw ?? 'admin').trim() || 'admin';
    await this.requireChannelAccess(req, agentId, channel);
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
      "Archive the persisted chat transcript for an agent/channel — the live JSONL is moved to a timestamped sibling (`bridle:<channel>.<iso-ts>.archived.jsonl`) and the live slot starts empty. Used by the embed's \"New chat\" action when the visitor wants a clean slate but we still want the prior conversation for admin/audit. No-op (returns `{}`) when there's nothing to archive. A `share-<visitorId>` channel is restricted: only a bearer token or that visitor's own share headers are accepted (403 otherwise).",
    operationId: 'archiveBridleTranscript',
  })
  @ApiQuery({
    name: 'channel',
    required: false,
    description: 'Session channel — defaults to "admin".',
  })
  @ApiShareHeaders()
  @ApiOkResponse({
    description:
      '`{ archivedPath }` for the timestamped copy, or `{}` when there was ' +
      'nothing to archive.',
  })
  @ApiForbiddenResponse({ description: SHARE_FORBIDDEN_DESCRIPTION })
  @FlatResponse()
  @Post(':agentId/transcript/archive')
  @HttpCode(200)
  async archiveTranscript(
    @Param('agentId') agentId: string,
    @Req() req: Record<string, unknown>,
    @Query('channel') channelRaw?: string,
  ): Promise<{ archivedPath?: string }> {
    const channel = (channelRaw ?? 'admin').trim() || 'admin';
    await this.requireChannelAccess(req, agentId, channel);
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
