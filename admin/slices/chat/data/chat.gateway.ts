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
  type IChatExportFile,
  type IChatFeedback,
  type IChatListQuery,
  type IChatListResult,
  type IChatMessagesQuery,
  type IChatMessagesResult,
  type IChatSession,
  type IChatSyncResult,
} from '../domain/chat.types';
import { ChatMapper } from './chat.mapper';

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

  getById(id: string): Promise<IChatSession | null> {
    return this.execute(async () => {
      const res = await ChatsService.getChat({ path: { id } });
      const dto = unwrapEnvelope<ChatSessionDto>(res.data);
      return dto ? this.mapper.toSession(dto) : null;
    });
  }

  messages(
    id: string,
    query: IChatMessagesQuery,
  ): Promise<IChatMessagesResult> {
    return this.execute(async () => {
      const res = await ChatsService.getChatMessages({ path: { id }, query });
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

  feedback(id: string): Promise<IChatFeedback[]> {
    return this.execute(async () => {
      const res = await ChatsService.getMyChatFeedback({ path: { id } });
      const dtos = unwrapEnvelope<ChatFeedbackDto[]>(res.data);
      return dtos ? this.mapper.toFeedbackList(dtos) : [];
    });
  }

  rate(id: string, messageId: string, rating: 1 | -1): Promise<void> {
    return this.execute(async () => {
      await ChatsService.createChatFeedback({
        path: { id },
        body: { messageId, rating },
      });
    });
  }

  unrate(id: string, messageId: string): Promise<void> {
    return this.execute(async () => {
      await ChatsService.deleteChatFeedback({ path: { id, messageId } });
    });
  }

  // Export is a file download — use the raw axios client (adds the Bearer header
  // via the interceptor) with a blob response, then resolve the bytes +
  // filename. The store performs the browser download.
  exportChat(id: string, format: ChatExportFormat): Promise<IChatExportFile> {
    return this.execute(async () => {
      const res = await apiClient.instance.get(`/chats/${id}/export`, {
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
