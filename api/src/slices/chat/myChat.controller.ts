import {
  Controller,
  ForbiddenException,
  Get,
  Logger,
  NotFoundException,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '#/user/auth/guards';
import { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import {
  TranscriptMessage,
  TranscriptReaderService,
} from '#/agent/file/domain';
import { IChatGateway, IChatSessionData } from './domain';
import {
  ChatListResponseDto,
  ChatMessagesQueryDto,
  ChatMessagesResponseDto,
  ChatSessionDto,
  MyChatsQueryDto,
} from './dtos';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

// End users only ever own their web/Bridle chats: a logged-in browser's
// clientId is the JWT `sub` (bridleClientWs.handler), so the session lives at
// `bridle:<sub>`. Telegram/slack chats key on the channel's own id, never the
// JWT sub — so scoping to bridle + sub is the exact "mine" set.
const OWN_CHANNEL = 'bridle';

// End users never see tool-call debug events — hard-capped, no `types` override.
const USER_TYPES: TranscriptMessage['role'][] = [
  'user',
  'assistant',
  'summary',
];

/**
 * End-user-facing "my chat history" (Phase 6). Unlike the admin ChatController
 * (Owner/Admin, sees every chat), this is JWT-only (any authenticated user) and
 * scoped server-side to the caller's OWN bridle sessions — a user can never
 * read another user's chat, and the id in the path is ownership-checked.
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
    const sub = this.requireSub(req);
    const page = q.page ?? 1;
    const perPage = q.perPage ?? 50;
    const { items, total } = await this.chats.list({
      channel: OWN_CHANNEL,
      externalUserId: sub,
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
    return this.requireOwned(id, this.requireSub(req));
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
    const session = await this.requireOwned(id, this.requireSub(req));

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
    sub: string,
  ): Promise<IChatSessionData> {
    const session = await this.chats.findById(id);
    if (
      !session ||
      session.channel !== OWN_CHANNEL ||
      session.externalUserId !== sub
    ) {
      throw new NotFoundException(`Chat ${id} not found`);
    }
    return session;
  }
}
