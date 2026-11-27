import { ChatsService } from '#api/data';
import { client as apiClient } from '#api/data/repositories/api/client.gen';
import type {
  ChatFeedbackDto,
  ChatListResponseDto,
  ChatMessagesResponseDto,
  ChatSessionDto,
  SyncChatsResponseDto,
} from '#api/data/repositories/api/types.gen';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { ErrorMapper } from '#error/data/error.mapper';
import { IChatGateway } from '../domain/chat.gateway';
import {
  emptyChatList,
  emptyChatMessages,
  type ChatExportFormat,
  type ChatScope,
  type IChatExportFile,
  type IChatFeedback,
  type IChatListQuery,
  type IChatListResult,
  type IChatMessagesQuery,
  type IChatMessagesResult,
  type IChatSession,
  type IChatSyncResult,
  type IOwnChatListQuery,
} from '../domain/chat.types';
import { ChatMapper } from './chat.mapper';

/** The HTTP status of a failure the generated client threw, if it had one. */
function statusOf(err: unknown): number | undefined {
  return (err as { response?: { status?: number } } | null)?.response?.status;
}

export class ChatGateway extends BaseGateway implements IChatGateway {
  private mapper = new ChatMapper();

  constructor() {
    // Route thrown SDK failures through the shared error mapper so callers get
    // a typed ErrorEntity (surfaced inline by the component / toasted by the
    // global handler) instead of an ad-hoc Error.
    super(new ErrorMapper());
  }

  list(query: IChatListQuery): Promise<IChatListResult> {
    return this.execute(async () => {
      const res = await ChatsService.getChats({ query });
      const dto = unwrapEnvelope<ChatListResponseDto>(res.data);
      return dto ? this.mapper.toList(dto) : emptyChatList(query);
    });
  }

  // The viewer's own conversations (CLEAN-248 route, read here since
  // CLEAN-269): with the Ranch assistant they are all an Admin may read.
  listOwn(query: IOwnChatListQuery): Promise<IChatListResult> {
    return this.execute(async () => {
      const res = await ChatsService.getMyChats({ query });
      const dto = unwrapEnvelope<ChatListResponseDto>(res.data);
      return dto ? this.mapper.toOwnList(dto) : emptyChatList(query);
    });
  }

  // "Not found" is an answer and comes back as null: the page says the chat
  // is not available. Anything else is a failure and is thrown, so that a
  // network error is not told as "it does not exist" (CLEAN-269).
  getById(id: string, scope: ChatScope): Promise<IChatSession | null> {
    return this.execute(async () => {
      try {
        const res =
          scope === 'own'
            ? await ChatsService.getMyChat({ path: { id }, throwOnError: true })
            : await ChatsService.getChat({ path: { id }, throwOnError: true });
        const dto = unwrapEnvelope<ChatSessionDto>(res.data);
        if (!dto) return null;
        const session = this.mapper.toSession(dto);
        return scope === 'own' ? this.mapper.asOwn(session) : session;
      } catch (err) {
        if (statusOf(err) === 404) return null;
        throw err;
      }
    });
  }

  messages(
    id: string,
    query: IChatMessagesQuery,
    scope: ChatScope,
  ): Promise<IChatMessagesResult> {
    return this.execute(async () => {
      // A person's own transcript never carries tool events, so `types` is
      // not a parameter of that route.
      const res =
        scope === 'own'
          ? await ChatsService.getMyChatMessages({
              path: { id },
              query: { limit: query.limit, cursor: query.cursor },
            })
          : await ChatsService.getChatMessages({ path: { id }, query });
      const dto = unwrapEnvelope<ChatMessagesResponseDto>(res.data);
      return dto ? this.mapper.toMessages(dto) : emptyChatMessages();
    });
  }

  sync(agentId?: string): Promise<IChatSyncResult | null> {
    return this.execute(async () => {
      const res = await ChatsService.syncChats({
        body: agentId ? { agentId } : {},
      });
      const dto = unwrapEnvelope<SyncChatsResponseDto>(res.data);
      return dto ? this.mapper.toSync(dto) : null;
    });
  }

  summarize(id: string): Promise<IChatSession | null> {
    return this.execute(async () => {
      // On-demand LLM summary can fail (bad credential, provider error).
      // `throwOnError: true` makes the axios client throw so `execute()` maps it
      // via ErrorMapper instead of silently returning the unchanged session.
      const res = await ChatsService.summarizeChat({
        path: { id },
        throwOnError: true,
      });
      const dto = unwrapEnvelope<ChatSessionDto>(res.data);
      return dto ? this.mapper.toSession(dto) : null;
    });
  }

  feedback(id: string, scope: ChatScope): Promise<IChatFeedback[]> {
    return this.execute(async () => {
      // `getMyChatFeedback` is the supervised route's name for "my marks on
      // this chat"; `listMyChatFeedback` is the same of the viewer's own chat.
      const res =
        scope === 'own'
          ? await ChatsService.listMyChatFeedback({ path: { id } })
          : await ChatsService.getMyChatFeedback({ path: { id } });
      const dtos = unwrapEnvelope<ChatFeedbackDto[]>(res.data);
      return dtos ? this.mapper.toFeedbackList(dtos) : [];
    });
  }

  rate(
    id: string,
    messageId: string,
    rating: 1 | -1,
    scope: ChatScope,
  ): Promise<void> {
    return this.execute(async () => {
      const options = { path: { id }, body: { messageId, rating } };
      if (scope === 'own') await ChatsService.createMyChatFeedback(options);
      else await ChatsService.createChatFeedback(options);
    });
  }

  unrate(id: string, messageId: string, scope: ChatScope): Promise<void> {
    return this.execute(async () => {
      const options = { path: { id, messageId } };
      if (scope === 'own') await ChatsService.deleteMyChatFeedback(options);
      else await ChatsService.deleteChatFeedback(options);
    });
  }

  // Export is a file download — use the raw axios client (adds the Bearer header
  // via the interceptor) with a blob response, then resolve the bytes +
  // filename. The store performs the browser download.
  exportChat(
    id: string,
    format: ChatExportFormat,
    scope: ChatScope,
  ): Promise<IChatExportFile> {
    return this.execute(async () => {
      const base = scope === 'own' ? '/me/chats' : '/chats';
      const res = await apiClient.instance.get(`${base}/${id}/export`, {
        params: { format },
        responseType: 'blob',
      });
      const dispo = (res.headers['content-disposition'] as string) ?? '';
      const filename =
        dispo.match(/filename="?([^"]+)"?/)?.[1] ??
        `chat-${id}.${format === 'markdown' ? 'md' : format}`;
      return { blob: res.data as Blob, filename };
    });
  }
}
