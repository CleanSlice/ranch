import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  Req,
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
import { Request } from 'express';
import { JwtAuthGuard, Roles, RolesGuard } from '#/user/auth/guards';
import { UserRoleTypes } from '#/user/user/domain';
import { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import {
  TranscriptReaderService,
  TranscriptMessage,
} from '#/agent/file/domain';
import { IChatGateway, ChatSyncService, ChatInsightService } from './domain';
import {
  FilterChatsDto,
  ChatListResponseDto,
  ChatSessionDto,
  ChatMessagesQueryDto,
  ChatMessagesResponseDto,
  SyncChatsDto,
  SyncChatsResponseDto,
  CreateChatFeedbackDto,
  ChatFeedbackDto,
} from './dtos';

type AuthedRequest = Request & { user?: IAuthTokenPayload };
const FEEDBACK_SOURCE = 'admin';

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
  ) {}

  @ApiOperation({
    description:
      'List chat sessions (index). Filter by agent, channel, search; paginated.',
    operationId: 'getChats',
  })
  @ApiOkResponse({ type: ChatListResponseDto })
  @Get()
  async list(@Query() filter: FilterChatsDto): Promise<ChatListResponseDto> {
    const page = filter.page ?? 1;
    const perPage = filter.perPage ?? 50;
    const { items, total } = await this.chats.list({
      ...filter,
      page,
      perPage,
    });
    return { items, total, page, perPage };
  }

  @ApiOperation({
    description: 'Get one chat session (index metadata).',
    operationId: 'getChat',
  })
  @ApiOkResponse({ type: ChatSessionDto })
  @Get(':id')
  async detail(@Param('id') id: string): Promise<ChatSessionDto> {
    const session = await this.chats.findById(id);
    if (!session) throw new NotFoundException(`Chat ${id} not found`);
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
  ): Promise<ChatMessagesResponseDto> {
    const session = await this.chats.findById(id);
    if (!session) throw new NotFoundException(`Chat ${id} not found`);

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

    return TranscriptReaderService.page(all, q.cursor, q.limit ?? 50);
  }

  @ApiOperation({
    description:
      'Reconcile the chat index against S3 session files (all agents, or one).',
    operationId: 'syncChats',
  })
  @ApiOkResponse({ type: SyncChatsResponseDto })
  @Post('sync')
  async syncChats(@Body() dto: SyncChatsDto): Promise<SyncChatsResponseDto> {
    return this.sync.syncAll(dto.agentId);
  }

  @ApiOperation({
    description:
      'Generate (or refresh) an LLM summary + insights for one chat, on demand.',
    operationId: 'summarizeChat',
  })
  @ApiOkResponse({ type: ChatSessionDto })
  @Post(':id/summarize')
  async summarize(@Param('id') id: string): Promise<ChatSessionDto> {
    return this.insight.summarize(id);
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
    const session = await this.chats.findById(id);
    if (!session) throw new NotFoundException(`Chat ${id} not found`);
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
    return this.chats.listFeedbackByAuthor(id, authorId);
  }
}
