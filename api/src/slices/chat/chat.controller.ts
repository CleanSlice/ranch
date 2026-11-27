import {
  ChatParticipantService,
  type IChatParticipant,
} from './domain/chatParticipant.service';
import { AgentPermissionService } from '#/agent/agent/domain/agentPermission.service';
import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  Req,
  Res,
  HttpCode,
  ForbiddenException,
  NotFoundException,
  UseGuards,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { JwtAuthGuard, Roles, RolesGuard } from '#/user/auth/guards';
import { UserRoleTypes } from '#/user/user/domain';
import { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
import { AgentScoped, accessCallerOf } from '#/user/agentAccess/guards';
import {
  TranscriptReaderService,
  TranscriptMessage,
} from '#/agent/file/domain';
import {
  IChatGateway,
  IChatTopicGateway,
  ChatSourceService,
  ChatSyncService,
  ChatInsightService,
  IChatSessionData,
  formatChatExport,
  topicLabelsFor,
} from './domain';
import {
  FilterChatsDto,
  ChatListResponseDto,
  ChatSessionDto,
  toChatSessionDto,
  ChatMessagesQueryDto,
  ChatMessagesResponseDto,
  SyncChatsDto,
  SyncChatsResponseDto,
  CreateChatFeedbackDto,
  ChatFeedbackDto,
  ExportChatQueryDto,
} from './dtos';

type AuthedRequest = Request & { user?: IAuthTokenPayload };
const FEEDBACK_SOURCE = 'admin';

/**
 * The language these routes name topics in (CLEAN-270). They serve the admin
 * console, which is English whatever the browser says (docs/i18n.md), so the
 * request's `Accept-Language` is not read here. `/me/chats` reads it.
 */
const TOPIC_LANGUAGE = 'en';

const ALLOWED_TYPES: TranscriptMessage['role'][] = [
  'user',
  'assistant',
  'summary',
  'tool_call',
  'tool_result',
  'system',
];
const DEFAULT_TYPES: TranscriptMessage['role'][] = [
  'user',
  'assistant',
  'summary',
];

@ApiTags('chats')
@ApiBearerAuth()
@Controller('chats')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly chats: IChatGateway,
    private readonly reader: TranscriptReaderService,
    private readonly sync: ChatSyncService,
    private readonly insight: ChatInsightService,
    private readonly sources: ChatSourceService,
    private readonly access: AgentAccessService,
    private readonly permission: AgentPermissionService,
    private readonly participants: ChatParticipantService,
    private readonly topics: IChatTopicGateway,
  ) {}

  /**
   * The conversations with who each one is with, in words (CLEAN-236). An
   * agent that handed a conversation over is named by the caller's reach on
   * using agents, not by `supervised`: being told a name is a question of
   * access to that agent, not of reading its conversations.
   *
   * And with the topics of each one's summary, by label (CLEAN-270): one
   * read of the topics for the whole page.
   *
   * What comes out is the DTO, field by field (`toChatSessionDto`), never
   * the row with something added to it: the row has columns no DTO
   * declares.
   */
  private async withParticipants(
    sessions: IChatSessionData[],
    req: AuthedRequest | undefined,
  ): Promise<ChatSessionDto[]> {
    const [reach, labelsOf] = await Promise.all([
      this.access.reachableIds(accessCallerOf(req)),
      topicLabelsFor(this.topics, sessions, TOPIC_LANGUAGE),
    ]);
    const participantOf = this.participants.forViewer((id) => reach.has(id));
    return Promise.all(
      sessions.map(async (session) => {
        const participant: IChatParticipant = await participantOf(session);
        return toChatSessionDto(session, {
          topics: labelsOf(session),
          person: participant.person,
          peer: participant.peer,
        });
      }),
    );
  }

  /**
   * The agents whose conversations this caller may read here: the ones they
   * reach (CLEAN-231), less any that only the Owner manages (CLEAN-236).
   *
   * These routes read what other people said to an agent. While every Owner
   * and Admin was one chat participant that added nothing: an Admin saw the
   * Owner's conversation with the Ranch admin agent in their own chat window
   * anyway. Now that the Owner's conversation is the Owner's, reading it
   * from this side is the supervision of an agent the Admin does not manage.
   */
  private async supervised(req: AuthedRequest | undefined) {
    const caller = accessCallerOf(req);
    const [reach, ownerOnly] = await Promise.all([
      this.access.reachableIds(caller),
      this.permission.ownerOnlyIds(caller),
    ]);
    return reach.without(ownerOnly);
  }

  /**
   * The session, when it exists and the caller may read the conversations
   * of its agent (`supervised`). One answer for both: a chat of a hidden
   * agent is a chat that does not exist.
   */
  private async requireChat(
    id: string,
    req: AuthedRequest | undefined,
  ): Promise<IChatSessionData> {
    const session = await this.chats.findById(id);
    const notFound = `Chat ${id} not found`;
    if (!session) throw new NotFoundException(notFound);
    if (!(await this.supervised(req)).has(session.agentId)) {
      throw new NotFoundException(notFound);
    }
    return session;
  }

  @ApiOperation({
    description:
      'List chat sessions (index). Filter by agent, channel, search; paginated.',
    operationId: 'getChats',
  })
  @ApiOkResponse({ type: ChatListResponseDto })
  @Get()
  @AgentScoped('query.agentId')
  async list(
    @Query() filter: FilterChatsDto,
    @Req() req?: AuthedRequest,
  ): Promise<ChatListResponseDto> {
    const page = filter.page ?? 1;
    const perPage = filter.perPage ?? 50;
    const reach = await this.supervised(req);
    // The guard asked whether the caller reaches a named agent. Whether its
    // conversations are theirs to read is asked here, with the answer an
    // agent with no conversations gives.
    if (filter.agentId && !reach.has(filter.agentId)) {
      return { items: [], total: 0, page, perPage };
    }
    const { items, total } = await this.chats.list({
      ...filter,
      agentScope: reach.where(),
      page,
      perPage,
    });
    return {
      items: await this.withParticipants(items, req),
      total,
      page,
      perPage,
    };
  }

  @ApiOperation({
    description: 'Get one chat session (index metadata).',
    operationId: 'getChat',
  })
  @ApiOkResponse({ type: ChatSessionDto })
  @Get(':id')
  async detail(
    @Param('id') id: string,
    @Req() req?: AuthedRequest,
  ): Promise<ChatSessionDto> {
    const [session] = await this.withParticipants(
      [await this.requireChat(id, req)],
      req,
    );
    return session;
  }

  @ApiOperation({
    description:
      "Replay a chat session's transcript from S3, tail-first. `summary` markers are " +
      'shown inline (compaction folds old turns into them); synthetic loop-control ' +
      'events are filtered. Admins may add tool_call,tool_result via `types`.',
    operationId: 'getChatMessages',
  })
  @ApiOkResponse({ type: ChatMessagesResponseDto })
  @Get(':id/messages')
  async messages(
    @Param('id') id: string,
    @Query() q: ChatMessagesQueryDto,
    @Req() req?: AuthedRequest,
  ): Promise<ChatMessagesResponseDto> {
    const session = await this.requireChat(id, req);

    const types = q.types
      ? (q.types
          .split(',')
          .map((t) => t.trim())
          .filter((t) =>
            (ALLOWED_TYPES as string[]).includes(t),
          ) as TranscriptMessage['role'][])
      : DEFAULT_TYPES;

    const path = `data/sessions/${session.sessionKey}.jsonl`;
    let all: TranscriptMessage[];
    try {
      all = await this.reader.read(session.agentId, path, {
        types,
        filterTransient: true,
      });
    } catch (err) {
      // Missing/unreadable file → empty transcript (row may predate the file, or
      // it was archived/reset). Don't 500 the whole page.
      this.logger.warn(
        `transcript read failed for ${session.agentId}/${session.sessionKey}: ${(err as Error).message}`,
      );
      return { messages: [], nextCursor: null, hasMore: false };
    }

    const page = TranscriptReaderService.page(all, q.cursor, q.limit ?? 50);
    // The full model-facing text of a user turn is a debug artefact: it
    // rides along only when the caller asked for tool events (the existing
    // debug signal), so ordinary browsing stays as small as before.
    const debug = types.includes('tool_call') || types.includes('tool_result');
    const messages = debug
      ? page.messages
      : TranscriptReaderService.withoutAgentText(page.messages);
    // The admin reads every conversation and opens any cited document.
    return {
      ...page,
      messages: await this.sources.attach(messages, {
        clientId: 'admin',
        isAdmin: true,
      }),
    };
  }

  @ApiOperation({
    description:
      'Reconcile the chat index against S3 session files (all agents, or one).',
    operationId: 'syncChats',
  })
  @ApiOkResponse({ type: SyncChatsResponseDto })
  @Post('sync')
  @AgentScoped('body.agentId')
  async syncChats(
    @Body() dto: SyncChatsDto,
    @Req() req?: AuthedRequest,
  ): Promise<SyncChatsResponseDto> {
    // With no agent named the sync walks the agents the caller reaches, and
    // counts only those (CLEAN-231).
    return this.sync.syncAll(dto.agentId, await this.supervised(req));
  }

  @ApiOperation({
    description:
      'Generate (or refresh) an LLM summary + insights for one chat, on demand: ' +
      'the main question, the outcome and the topics with it.',
    operationId: 'summarizeChat',
  })
  @ApiOkResponse({ type: ChatSessionDto })
  @Post(':id/summarize')
  async summarize(
    @Param('id') id: string,
    @Req() req?: AuthedRequest,
  ): Promise<ChatSessionDto> {
    await this.requireChat(id, req);
    // As `detail` answers it, so the page that asked can replace its row:
    // the new topics by label, and who the conversation is with.
    const [session] = await this.withParticipants(
      [await this.insight.summarize(id)],
      req,
    );
    return session;
  }

  @ApiOperation({
    description: 'Set the current user’s 👍/👎 on an assistant message.',
    operationId: 'createChatFeedback',
  })
  @ApiOkResponse({ type: ChatFeedbackDto })
  @Post(':id/feedback')
  async createFeedback(
    @Param('id') id: string,
    @Body() dto: CreateChatFeedbackDto,
    @Req() req: AuthedRequest,
  ): Promise<ChatFeedbackDto> {
    const authorId = req.user?.sub;
    if (!authorId) throw new ForbiddenException('No authenticated user');
    await this.requireChat(id, req);
    return this.chats.upsertFeedback({
      sessionId: id,
      messageId: dto.messageId,
      rating: dto.rating,
      comment: dto.comment,
      source: FEEDBACK_SOURCE,
      authorId,
    });
  }

  @ApiOperation({
    description: 'Clear the current user’s feedback on a message (toggle-off).',
    operationId: 'deleteChatFeedback',
  })
  @HttpCode(204)
  @Delete(':id/feedback/:messageId')
  async deleteFeedback(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Req() req: AuthedRequest,
  ): Promise<void> {
    const authorId = req.user?.sub;
    if (!authorId) throw new ForbiddenException('No authenticated user');
    await this.requireChat(id, req);
    await this.chats.deleteFeedback(id, messageId, authorId);
  }

  @ApiOperation({
    description: 'List the current user’s feedback for a chat session.',
    operationId: 'getMyChatFeedback',
  })
  @ApiOkResponse({ type: [ChatFeedbackDto] })
  @Get(':id/feedback')
  async myFeedback(
    @Param('id') id: string,
    @Req() req: AuthedRequest,
  ): Promise<ChatFeedbackDto[]> {
    const authorId = req.user?.sub ?? '';
    await this.requireChat(id, req);
    return this.chats.listFeedbackByAuthor(id, authorId);
  }

  @ApiOperation({
    description: 'Download a chat transcript as json / markdown / csv.',
    operationId: 'exportChat',
  })
  // @Res() bypasses the global {success,data} interceptor so we return the raw
  // file with download headers (same pattern as file export).
  @Get(':id/export')
  async export(
    @Param('id') id: string,
    @Query() q: ExportChatQueryDto,
    @Res() res: Response,
    @Req() req?: AuthedRequest,
  ): Promise<void> {
    const session = await this.requireChat(id, req);

    const format = q.format ?? 'json';
    const types: TranscriptMessage['role'][] =
      format === 'json' ? ALLOWED_TYPES : ['user', 'assistant', 'summary'];
    const path = `data/sessions/${session.sessionKey}.jsonl`;
    let messages: TranscriptMessage[] = [];
    try {
      messages = await this.reader.read(session.agentId, path, {
        types,
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
}
