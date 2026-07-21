import { createServiceGetter } from '#common/composables/createServiceGetter';
import { BridleRoleTypes } from '#bridle/domain';
import type { BridleService, IBridleMessage } from '#bridle/domain';

// Re-export the domain enum/types so consumers importing them from
// `#bridle/stores/bridle` (Message.vue) keep working. `BridleRoleTypes` is used
// as a runtime value, so it's a value re-export (not `export type`).
export { BridleRoleTypes } from '#bridle/domain';
export type { IBridleMessage, IBridleReply } from '#bridle/domain';

const getService = createServiceGetter<BridleService>('$bridleService');

// localStorage persistence for chat conversations — survives page refresh.
// Scoped per agentId so switching agents doesn't bleed history. Mirrors the
// admin's per-bot persistence pattern for debug snapshots.
const CONVERSATION_STORAGE_PREFIX = 'bridle:conversation:';

function loadConversationFromStorage(agentId: string): IBridleMessage[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CONVERSATION_STORAGE_PREFIX + agentId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as IBridleMessage[];
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    console.warn('[bridle] failed to load persisted conversation', err);
    return null;
  }
}

function saveConversationToStorage(
  agentId: string,
  messages: IBridleMessage[],
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      CONVERSATION_STORAGE_PREFIX + agentId,
      JSON.stringify(messages),
    );
  } catch (err) {
    // Quota exceeded or storage disabled — best-effort, ignore.
    console.warn('[bridle] failed to persist conversation', err);
  }
}

function clearConversationFromStorage(agentId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(CONVERSATION_STORAGE_PREFIX + agentId);
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

  const messagesFor = (agentId: string) => conversations.value[agentId] ?? [];
  const isPending = (agentId: string) => pending.value[agentId] === true;
  const errorFor = (agentId: string) => errors.value[agentId] ?? null;

  /**
   * Replay persisted messages for the given bot from localStorage. Idempotent —
   * called from the Provider on mount so the chat survives a page refresh.
   * Avoids overwriting an existing in-memory conversation (e.g. if the user
   * navigated away and back without reloading).
   */
  function hydrate(agentId: string) {
    if (hydrated.value[agentId]) return;
    hydrated.value[agentId] = true;
    if (conversations.value[agentId]?.length) return;
    const stored = loadConversationFromStorage(agentId);
    if (stored && stored.length) conversations.value[agentId] = stored;
  }

  function persist(agentId: string) {
    const messages = conversations.value[agentId];
    if (messages && messages.length) saveConversationToStorage(agentId, messages);
    else clearConversationFromStorage(agentId);
  }

  function appendMessage(agentId: string, message: IBridleMessage) {
    if (!conversations.value[agentId]) conversations.value[agentId] = [];
    conversations.value[agentId].push(message);
    persist(agentId);
  }

  async function sendMessage(agentId: string, text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending.value[agentId]) return;

    appendMessage(agentId, {
      id: `u-${Date.now()}`,
      role: BridleRoleTypes.User,
      text: trimmed,
      ts: Date.now(),
    });

    pending.value[agentId] = true;
    errors.value[agentId] = null;

    try {
      const reply = await getService().sendMessage(agentId, trimmed);
      appendMessage(agentId, {
        id: reply.messageId || `a-${Date.now()}`,
        role: BridleRoleTypes.Agent,
        text: reply.text,
        ts: reply.ts ?? Date.now(),
      });
    } catch (err) {
      errors.value[agentId] =
        (err as Error).message || 'Failed to reach agent';
    } finally {
      pending.value[agentId] = false;
    }
  }

  function reset(agentId: string) {
    delete conversations.value[agentId];
    delete pending.value[agentId];
    delete errors.value[agentId];
    clearConversationFromStorage(agentId);
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
