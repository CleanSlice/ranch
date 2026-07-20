import { ChatsService } from '#api';
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
import { IChatGateway } from '../domain/chat.gateway';
import {
  emptyChatList,
  emptyChatMessages,
  type ChatExportFormat,
  type IChatExportFile,
  type IChatFeedback,
  type IChatListResult,
  type IChatMessagesQuery,
  type IChatMessagesResult,
  type IChatSession,
  type IChatSyncResult,
} from '../domain/chat.types';
import { ChatMapper } from './chat.mapper';

export class ChatGateway extends BaseGateway implements IChatGateway {
  private mapper = new ChatMapper();

  listMine(page: number, perPage: number): Promise<IChatListResult> {
    return this.execute(async () => {
      const res = await ChatsService.getMyChats({ query: { page, perPage } });
      const dto = unwrapEnvelope<ChatListResponseDto>(res.data);
      return dto ? this.mapper.toList(dto) : emptyChatList(page, perPage);
    });
  }

  getMine(id: string): Promise<IChatSession | null> {
    return this.execute(async () => {
      const res = await ChatsService.getMyChat({ path: { id } });
      const dto = unwrapEnvelope<ChatSessionDto>(res.data);
      return dto ? this.mapper.toSession(dto) : null;
    });
  }

  messages(
    id: string,
    query: IChatMessagesQuery,
  ): Promise<IChatMessagesResult> {
    return this.execute(async () => {
      const res = await ChatsService.getMyChatMessages({ path: { id }, query });
      const dto = unwrapEnvelope<ChatMessagesResponseDto>(res.data);
      return dto ? this.mapper.toMessages(dto) : emptyChatMessages();
    });
  }

  syncMine(agentId?: string): Promise<IChatSyncResult | null> {
    return this.execute(async () => {
      const res = await ChatsService.syncMyChats({
        body: agentId ? { agentId } : {},
      });
      const dto = unwrapEnvelope<SyncChatsResponseDto>(res.data);
      return dto ? this.mapper.toSync(dto) : null;
    });
  }

  feedback(id: string): Promise<IChatFeedback[]> {
    return this.execute(async () => {
      const res = await ChatsService.listMyChatFeedback({ path: { id } });
      const dtos = unwrapEnvelope<ChatFeedbackDto[]>(res.data);
      return dtos ? this.mapper.toFeedbackList(dtos) : [];
    });
  }

  rate(id: string, messageId: string, rating: 1 | -1): Promise<void> {
    return this.execute(async () => {
      await ChatsService.createMyChatFeedback({
        path: { id },
        body: { messageId, rating },
      });
    });
  }

  unrate(id: string, messageId: string): Promise<void> {
    return this.execute(async () => {
      await ChatsService.deleteMyChatFeedback({ path: { id, messageId } });
    });
  }

  // Export is a file download — use the raw axios client (carries the base URL
  // + Bearer header from the shared client config) with a blob response, then
  // resolve the bytes + filename. The store performs the browser download.
  exportChat(id: string, format: ChatExportFormat): Promise<IChatExportFile> {
    return this.execute(async () => {
      const res = await apiClient.instance.get(`/me/chats/${id}/export`, {
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
