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

interface IEnvelope<T> {
  success?: boolean;
  data?: T;
}

function unwrap<T>(body: unknown): T | null {
  if (body && typeof body === 'object' && 'data' in (body as IEnvelope<T>)) {
    return ((body as IEnvelope<T>).data ?? null) as T | null;
  }
  return (body ?? null) as T | null;
}

// localStorage persistence for chat conversations — survives page refresh.
// Scoped per botId so switching agents doesn't bleed history. Mirrors the
// admin's per-bot persistence pattern for debug snapshots.
const CONVERSATION_STORAGE_PREFIX = 'bridle:conversation:';

function loadConversationFromStorage(botId: string): IBridleMessage[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CONVERSATION_STORAGE_PREFIX + botId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as IBridleMessage[];
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    console.warn('[bridle] failed to load persisted conversation', err);
    return null;
  }
}

function saveConversationToStorage(
  botId: string,
  messages: IBridleMessage[],
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      CONVERSATION_STORAGE_PREFIX + botId,
      JSON.stringify(messages),
    );
  } catch (err) {
    // Quota exceeded or storage disabled — best-effort, ignore.
    console.warn('[bridle] failed to persist conversation', err);
  }
}

function clearConversationFromStorage(botId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(CONVERSATION_STORAGE_PREFIX + botId);
  } catch {
    // ignore
  }
}

export const useBridleStore = defineStore('bridle', () => {
  const conversations = ref<Record<string, IBridleMessage[]>>({});
  const pending = ref<Record<string, boolean>>({});
  const errors = ref<Record<string, string | null>>({});
  /** Bots whose conversation has been pulled from localStorage already. */
  const hydrated = ref<Record<string, boolean>>({});

  const messagesFor = (botId: string) => conversations.value[botId] ?? [];
  const isPending = (botId: string) => pending.value[botId] === true;
  const errorFor = (botId: string) => errors.value[botId] ?? null;

  /**
   * Replay persisted messages for the given bot from localStorage. Idempotent —
   * called from the Provider on mount so the chat survives a page refresh.
   * Avoids overwriting an existing in-memory conversation (e.g. if the user
   * navigated away and back without reloading).
   */
  function hydrate(botId: string) {
    if (hydrated.value[botId]) return;
    hydrated.value[botId] = true;
    if (conversations.value[botId]?.length) return;
    const stored = loadConversationFromStorage(botId);
    if (stored && stored.length) conversations.value[botId] = stored;
  }

  function persist(botId: string) {
    const messages = conversations.value[botId];
    if (messages && messages.length) saveConversationToStorage(botId, messages);
    else clearConversationFromStorage(botId);
  }

  function appendMessage(botId: string, message: IBridleMessage) {
    if (!conversations.value[botId]) conversations.value[botId] = [];
    conversations.value[botId].push(message);
    persist(botId);
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
      const data = unwrap<ISyncResponse>(res.data) ?? {};
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
    clearConversationFromStorage(botId);
  }

  return {
    conversations,
    messagesFor,
    isPending,
    errorFor,
    hydrate,
    sendMessage,
    reset,
  };
});
