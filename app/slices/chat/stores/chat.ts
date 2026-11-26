import { createServiceGetter } from '#common/composables/createServiceGetter';
import type { ChatService } from '#chat/domain';
import type {
  ChatExportFormat,
  IChatMessagesQuery,
  IChatSession,
} from '#chat/domain';

// Re-export the domain types so existing consumers that import them from
// `#chat/stores/chat` (Bubble, the history components) keep working.
export type {
  ChatExportFormat,
  ChatMessageRole,
  IChatExportFile,
  IChatFeedback,
  IChatInsights,
  IChatListQuery,
  IChatListResult,
  IChatMessage,
  IChatMessagesQuery,
  IChatMessagesResult,
  IChatSession,
  IChatSyncResult,
} from '#chat/domain';

const getService = createServiceGetter<ChatService>('$chatService');

/**
 * Closed conversations asked for at a time. About three screens of rows in
 * the agent panel, and the first page is loaded when an agent opens: the one
 * request then serves the History counter and makes the list appear without
 * a wait. The API allows up to 100.
 */
export const HISTORY_PAGE_SIZE = 30;

export type ChatHistoryStatus = 'idle' | 'loading' | 'loading-more' | 'error';

/** One agent's history, as far as it has been loaded: ids, never records. */
interface IAgentHistory {
  /** The conversation going on now. Normally none or one. */
  currentIds: string[];
  /** Closed conversations, most recently active first, pages appended. */
  closedIds: string[];
  /**
   * How many closed conversations there are with this agent, for the
   * counter. Written from an unsearched answer only: a searched total is the
   * number of matches. `null` until one has arrived.
   */
  closedTotal: number | null;
  /** The search `closedIds` answers. */
  search: string;
  page: number;
  hasMore: boolean;
  /** The last "load more" failed; the list is kept and offers a retry. */
  moreFailed: boolean;
  status: ChatHistoryStatus;
  /** Bumped by every first-page request: a later answer wins, whenever it lands. */
  generation: number;
}

export interface IChatHistoryState {
  status: ChatHistoryStatus;
  hasMore: boolean;
  moreFailed: boolean;
  search: string;
}

function emptyHistory(): IAgentHistory {
  return {
    currentIds: [],
    closedIds: [],
    closedTotal: null,
    search: '',
    page: 0,
    hasMore: false,
    moreFailed: false,
    status: 'idle',
    generation: 0,
  };
}

/** Save an already-fetched blob to disk (client-only DOM side effect). */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * UI-facing facade over `ChatService`, and the one place a conversation
 * record lives (docs/state.md): every answer that carries conversations is
 * written into `byId`, lists hold ids, components render by id.
 */
export const useChatStore = defineStore('chat', () => {
  /** Every conversation this account has loaded, once. */
  const byId = ref<Record<string, IChatSession>>({});
  /** What has been loaded of each agent's history (CLEAN-248). */
  const history = ref<Record<string, IAgentHistory>>({});

  // Bumped by `resetForAccount`: an answer that was on its way when the
  // account changed is the previous account's and is dropped.
  let accountGeneration = 0;

  /**
   * Whoever was signed in is not any more (CLEAN-231): their conversations
   * leave the page with them. The ONE way this store is emptied for an
   * account change (docs/state.md).
   */
  function resetForAccount() {
    accountGeneration += 1;
    byId.value = {};
    history.value = {};
  }

  function upsert(items: IChatSession[]) {
    for (const item of items) byId.value[item.id] = item;
  }

  /** The agent's index, created empty on first use. Always the reactive one. */
  function historyOf(agentId: string): IAgentHistory {
    if (!history.value[agentId]) history.value[agentId] = emptyHistory();
    return history.value[agentId]!;
  }

  /**
   * Load the first page of one agent's history: the conversation going on
   * now, and the closed ones, optionally narrowed by a search. Never throws:
   * a failure is the index's `status`, and what was listed stays listed.
   */
  async function loadHistory(agentId: string, search = ''): Promise<void> {
    const mine = historyOf(agentId);
    mine.generation += 1;
    mine.status = 'loading';
    const generation = mine.generation;
    const account = accountGeneration;
    // An answer is for this request only while nothing newer has been asked
    // and the account is the one that asked.
    const still = (): IAgentHistory | null => {
      if (account !== accountGeneration) return null;
      const now = history.value[agentId];
      return now && now.generation === generation ? now : null;
    };
    try {
      const [current, closed] = await Promise.all([
        getService().listMine({
          agentId,
          archived: false,
          page: 1,
          perPage: HISTORY_PAGE_SIZE,
        }),
        getService().listMine({
          agentId,
          archived: true,
          search: search || undefined,
          page: 1,
          perPage: HISTORY_PAGE_SIZE,
        }),
      ]);
      const now = still();
      if (!now) return;
      upsert(current.items);
      upsert(closed.items);
      now.currentIds = current.items.map((s) => s.id);
      now.closedIds = closed.items.map((s) => s.id);
      now.search = search;
      now.page = 1;
      now.hasMore = closed.items.length < closed.total;
      now.moreFailed = false;
      if (!search) now.closedTotal = closed.total;
      now.status = 'idle';
    } catch {
      const now = still();
      if (now) now.status = 'error';
    }
  }

  /** Append the next page of closed conversations for the current search. */
  async function loadMoreHistory(agentId: string): Promise<void> {
    const mine = history.value[agentId];
    if (!mine || mine.status !== 'idle' || !mine.hasMore) return;
    mine.status = 'loading-more';
    const generation = mine.generation;
    const account = accountGeneration;
    const page = mine.page + 1;
    const still = (): IAgentHistory | null => {
      if (account !== accountGeneration) return null;
      const now = history.value[agentId];
      return now && now.generation === generation ? now : null;
    };
    try {
      const closed = await getService().listMine({
        agentId,
        archived: true,
        search: mine.search || undefined,
        page,
        perPage: HISTORY_PAGE_SIZE,
      });
      const now = still();
      if (!now) return;
      upsert(closed.items);
      // A conversation closed between two pages shifts the rows by one; an
      // id already listed is not listed again.
      const listed = new Set(now.closedIds);
      for (const item of closed.items) {
        if (!listed.has(item.id)) now.closedIds.push(item.id);
      }
      now.page = page;
      // An empty page ends the list whatever the total says: without this a
      // total that moved would ask for the same empty page for ever.
      now.hasMore = closed.items.length > 0 && now.closedIds.length < closed.total;
      now.moreFailed = false;
      if (!now.search) now.closedTotal = closed.total;
      now.status = 'idle';
    } catch {
      const now = still();
      if (!now) return;
      now.moreFailed = true;
      now.status = 'idle';
    }
  }

  /** Reload the first page with the search the list is shown with. */
  function refreshHistory(agentId: string): Promise<void> {
    return loadHistory(agentId, history.value[agentId]?.search ?? '');
  }

  /**
   * Ask the server to reconcile this agent's conversations into the index,
   * then reload: the manual way out when a conversation is not listed yet.
   */
  async function syncHistory(agentId: string): Promise<void> {
    try {
      await getService().syncMine(agentId);
    } catch {
      // The reload below still shows what the index has.
    }
    await refreshHistory(agentId);
  }

  /** Closed conversations with this agent, or `null` while not known. */
  function closedCountFor(agentId: string): number | null {
    return history.value[agentId]?.closedTotal ?? null;
  }

  function recordsOf(ids: string[] | undefined): IChatSession[] {
    const records: IChatSession[] = [];
    for (const id of ids ?? []) {
      const record = byId.value[id];
      if (record) records.push(record);
    }
    return records;
  }

  /** The conversation going on now with this agent (none, or one). */
  function currentFor(agentId: string): IChatSession[] {
    return recordsOf(history.value[agentId]?.currentIds);
  }

  /** The closed conversations loaded so far, most recently active first. */
  function closedFor(agentId: string): IChatSession[] {
    return recordsOf(history.value[agentId]?.closedIds);
  }

  function historyStateFor(agentId: string): IChatHistoryState {
    const mine = history.value[agentId];
    return {
      status: mine?.status ?? 'idle',
      hasMore: mine?.hasMore ?? false,
      moreFailed: mine?.moreFailed ?? false,
      search: mine?.search ?? '',
    };
  }

  /** One conversation by id; stored before it is returned (docs/state.md). */
  async function getMine(id: string): Promise<IChatSession | null> {
    const account = accountGeneration;
    const found = await getService().getMine(id);
    if (found && account === accountGeneration) upsert([found]);
    return found;
  }

  function messages(id: string, query: IChatMessagesQuery = {}) {
    return getService().messages(id, query);
  }

  function syncMine(agentId?: string) {
    return getService().syncMine(agentId);
  }

  function feedback(id: string) {
    return getService().feedback(id);
  }

  function rate(id: string, messageId: string, rating: 1 | -1) {
    return getService().rate(id, messageId, rating);
  }

  function unrate(id: string, messageId: string) {
    return getService().unrate(id, messageId);
  }

  async function exportChat(id: string, format: ChatExportFormat) {
    const { blob, filename } = await getService().exportChat(id, format);
    triggerDownload(blob, filename);
  }

  return {
    byId,
    history,
    resetForAccount,
    loadHistory,
    loadMoreHistory,
    refreshHistory,
    syncHistory,
    closedCountFor,
    currentFor,
    closedFor,
    historyStateFor,
    getMine,
    messages,
    syncMine,
    feedback,
    rate,
    unrate,
    exportChat,
  };
});
