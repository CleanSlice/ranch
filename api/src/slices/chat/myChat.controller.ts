import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
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
import { Request, Response } from 'express';
import { JwtAuthGuard } from '#/user/auth/guards';
import { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import { UserRoleTypes } from '#/user/user/domain';
import {
  TranscriptMessage,
  TranscriptReaderService,
} from '#/agent/file/domain';
import {
  IChatGateway,
  IChatSessionData,
  ChatSyncService,
  formatChatExport,
} from './domain';
import {
  ChatFeedbackDto,
  ChatListResponseDto,
  ChatMessagesQueryDto,
  ChatMessagesResponseDto,
  ChatSessionDto,
  CreateChatFeedbackDto,
  ExportChatQueryDto,
  MyChatsQueryDto,
  SyncChatsDto,
  SyncChatsResponseDto,
} from './dtos';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

const OWN_CHANNEL = 'bridle';
const APP_FEEDBACK_SOURCE = 'app';

// End users never see tool-call debug events — hard-capped, no `types` override,
// and export is capped the same way (no tool events leak, even in json).
const USER_TYPES: TranscriptMessage['role'][] = [
  'user',
  'assistant',
  'summary',
];

/**
 * End-user-facing "my chat history" (Phase 6). Unlike the admin ChatController
 * (Owner/Admin, sees every chat), this is JWT-only (any authenticated user) and
 * scoped server-side to the caller's OWN bridle sessions — a user can never
 * read another user's chat, and every id in the path is ownership-checked.
 */
@ApiTags('chats')
@ApiBearerAuth()
@Controller('me/chats')
@UseGuards(JwtAuthGuard)
export class MyChatController {
  private readonly logger = new Logger(MyChatController.name);

  constructor(
    private readonly chats: IChatGateway,
    private readonly reader: TranscriptReaderService,
    private readonly sync: ChatSyncService,
  ) {}

  @ApiOperation({
    description: "List the current user's own chat sessions, newest first.",
    operationId: 'getMyChats',
  })
  @ApiOkResponse({ type: ChatListResponseDto })
  @Get()
  async list(
    @Query() q: MyChatsQueryDto,
    @Req() req: AuthedRequest,
  ): Promise<ChatListResponseDto> {
    const page = q.page ?? 1;
    const perPage = q.perPage ?? 50;
    const { items, total } = await this.chats.list({
      channel: OWN_CHANNEL,
      externalUserId: this.ownExternalId(req),
      archived: q.archived ?? false,
      page,
      perPage,
    });
    return { items, total, page, perPage };
  }

  @ApiOperation({
    description: "Get one of the current user's own chat sessions.",
    operationId: 'getMyChat',
  })
  @ApiOkResponse({ type: ChatSessionDto })
  @Get(':id')
  async detail(
    @Param('id') id: string,
    @Req() req: AuthedRequest,
  ): Promise<ChatSessionDto> {
    return this.requireOwned(id, this.ownExternalId(req));
  }

  @ApiOperation({
    description:
      "Replay one of the current user's own chats, tail-first. `summary` " +
      'markers are shown inline; tool events are never exposed to end users.',
    operationId: 'getMyChatMessages',
  })
  @ApiOkResponse({ type: ChatMessagesResponseDto })
  @Get(':id/messages')
  async messages(
    @Param('id') id: string,
    @Query() q: ChatMessagesQueryDto,
    @Req() req: AuthedRequest,
  ): Promise<ChatMessagesResponseDto> {
    const session = await this.requireOwned(id, this.ownExternalId(req));

    const path = `data/sessions/${session.sessionKey}.jsonl`;
    let all: TranscriptMessage[];
    try {
      all = await this.reader.read(session.agentId, path, {
        types: USER_TYPES,
        filterTransient: true,
      });
    } catch (err) {
      this.logger.warn(
        `transcript read failed for ${session.agentId}/${session.sessionKey}: ${(err as Error).message}`,
      );
      return { messages: [], nextCursor: null, hasMore: false };
    }

    return TranscriptReaderService.page(all, q.cursor, q.limit ?? 50);
  }

  @ApiOperation({
    description:
      "Reconcile the current user's OWN chats from S3 into the index " +
      '(self-service, non-admin). Only sessions belonging to the caller are ' +
      'touched. A manual fallback when realtime indexing has not caught up.',
    operationId: 'syncMyChats',
  })
  @ApiOkResponse({ type: SyncChatsResponseDto })
  @Post('sync')
  async syncMine(
    @Body() dto: SyncChatsDto,
    @Req() req: AuthedRequest,
  ): Promise<SyncChatsResponseDto> {
    return this.sync.syncForExternalUser(this.ownExternalId(req), dto.agentId);
  }

  @ApiOperation({
    description: "Set the current user's 👍/👎 on a message in their own chat.",
    operationId: 'createMyChatFeedback',
  })
  @ApiOkResponse({ type: ChatFeedbackDto })
  @Post(':id/feedback')
  async createFeedback(
    @Param('id') id: string,
    @Body() dto: CreateChatFeedbackDto,
    @Req() req: AuthedRequest,
  ): Promise<ChatFeedbackDto> {
    await this.requireOwned(id, this.ownExternalId(req));
    return this.chats.upsertFeedback({
      sessionId: id,
      messageId: dto.messageId,
      rating: dto.rating,
      comment: dto.comment,
      source: APP_FEEDBACK_SOURCE,
      // authorId is the caller's real user id (`sub`), NOT the resolved channel
      // id — two admins on the shared 'admin' channel are still distinct authors.
      authorId: this.requireSub(req),
    });
  }

  @ApiOperation({
    description: "Clear the current user's feedback on a message (toggle-off).",
    operationId: 'deleteMyChatFeedback',
  })
  @HttpCode(204)
  @Delete(':id/feedback/:messageId')
  async deleteFeedback(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Req() req: AuthedRequest,
  ): Promise<void> {
    await this.requireOwned(id, this.ownExternalId(req));
    await this.chats.deleteFeedback(id, messageId, this.requireSub(req));
  }

  @ApiOperation({
    description: "List the current user's own feedback for one of their chats.",
    operationId: 'listMyChatFeedback',
  })
  @ApiOkResponse({ type: [ChatFeedbackDto] })
  @Get(':id/feedback')
  async listFeedback(
    @Param('id') id: string,
    @Req() req: AuthedRequest,
  ): Promise<ChatFeedbackDto[]> {
    await this.requireOwned(id, this.ownExternalId(req));
    return this.chats.listFeedbackByAuthor(id, this.requireSub(req));
  }

  @ApiOperation({
    description:
      "Download the current user's own chat as json / markdown / csv.",
    operationId: 'exportMyChat',
  })
  // @Res() bypasses the global {success,data} interceptor so we return the raw
  // file with download headers (same pattern as the admin export).
  @Get(':id/export')
  async export(
    @Param('id') id: string,
    @Query() q: ExportChatQueryDto,
    @Req() req: AuthedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const session = await this.requireOwned(id, this.ownExternalId(req));
    const format = q.format ?? 'json';
    const path = `data/sessions/${session.sessionKey}.jsonl`;
    let messages: TranscriptMessage[] = [];
    try {
      messages = await this.reader.read(session.agentId, path, {
        types: USER_TYPES, // no tool events for end users, even in json
        filterTransient: true,
      });
    } catch (err) {
      this.logger.warn(
        `export read failed for ${session.agentId}/${session.sessionKey}: ${(err as Error).message}`,
      );
    }

    const { body, contentType, ext } = formatChatExport(
      format,
      session,
      messages,
    );
    const safeKey = session.sessionKey.replace(/[^\w.-]/g, '_');
    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="chat-${safeKey}.${ext}"`,
    );
    res.end(body);
  }

  /**
   * The caller's OWN bridle identity — the exact value their chats are keyed
   * under (ChatSession.externalUserId / `bridle:<id>`). Mirrors the bridle
   * client handler + HTTP resolveClientId: owners/admins collapse to the shared
   * `admin` channel; everyone else is their JWT `sub`. Keep these in lockstep —
   * if they diverge, "my history" silently shows nothing.
   */
  private ownExternalId(req: AuthedRequest): string {
    const sub = this.requireSub(req);
    const roles = req.user?.roles ?? [];
    const isAdmin =
      roles.includes(UserRoleTypes.Owner) ||
      roles.includes(UserRoleTypes.Admin);
    return isAdmin ? 'admin' : sub;
  }

  private requireSub(req: AuthedRequest): string {
    const sub = req.user?.sub;
    if (!sub) throw new ForbiddenException('No authenticated user');
    return sub;
  }

  /**
   * Fetch a session and prove the caller owns it. Returns 404 (not 403) on a
   * mismatch so we never confirm the existence of someone else's chat.
   */
  private async requireOwned(
    id: string,
    externalUserId: string,
  ): Promise<IChatSessionData> {
    const session = await this.chats.findById(id);
    if (
      !session ||
      session.channel !== OWN_CHANNEL ||
      session.externalUserId !== externalUserId
    ) {
      throw new NotFoundException(`Chat ${id} not found`);
    }
    return session;
  }
}
