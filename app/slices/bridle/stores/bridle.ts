import { BridleService } from '#api';

export enum BridleRoleTypes {
  User = 'user',
  Agent = 'agent',
}

export interface IBridleMessage {
  id: string;
  role: BridleRoleTypes;
  text: string;
  ts: number;
}

interface ISyncResponse {
  text?: string;
  messageId?: string;
  ts?: number;
}

export const useBridleStore = defineStore('bridle', () => {
  const conversations = ref<Record<string, IBridleMessage[]>>({});
  const pending = ref<Record<string, boolean>>({});
  const errors = ref<Record<string, string | null>>({});

  const messagesFor = (botId: string) => conversations.value[botId] ?? [];
  const isPending = (botId: string) => pending.value[botId] === true;
  const errorFor = (botId: string) => errors.value[botId] ?? null;

  function appendMessage(botId: string, message: IBridleMessage) {
    if (!conversations.value[botId]) conversations.value[botId] = [];
    conversations.value[botId].push(message);
  }

  async function sendMessage(botId: string, text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending.value[botId]) return;

    appendMessage(botId, {
      id: `u-${Date.now()}`,
      role: BridleRoleTypes.User,
      text: trimmed,
      ts: Date.now(),
    });

    pending.value[botId] = true;
    errors.value[botId] = null;

    try {
      const res = await BridleService.sendBridleMessageSync({
        path: { botId },
        body: { text: trimmed },
      });
      const data = (res.data as ISyncResponse) ?? {};
      appendMessage(botId, {
        id: data.messageId || `a-${Date.now()}`,
        role: BridleRoleTypes.Agent,
        text: data.text ?? '',
        ts: data.ts ?? Date.now(),
      });
    } catch (err) {
      errors.value[botId] =
        (err as Error).message || 'Failed to reach agent';
    } finally {
      pending.value[botId] = false;
    }
  }

  function reset(botId: string) {
    delete conversations.value[botId];
    delete pending.value[botId];
    delete errors.value[botId];
  }

  return {
    conversations,
    messagesFor,
    isPending,
    errorFor,
    sendMessage,
    reset,
  };
});
