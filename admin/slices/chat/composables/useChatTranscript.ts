import type { IChatMessage } from '#chat/stores/chat';

const PAGE = 50;

/**
 * Paged transcript of one chat session: newest page first, "load older"
 * prepends while keeping the viewport anchored, and the tool-events toggle
 * re-fetches from the latest page. Loads on mount.
 */
export function useChatTranscript(chatId: string) {
  const store = useChatStore();

  const messages = ref<IChatMessage[]>([]);
  const cursor = ref<string | null>(null);
  const hasMore = ref(false);
  const loading = ref(false);
  const showTools = ref(false);
  const scroller = ref<HTMLElement | null>(null);

  const types = computed(() =>
    showTools.value
      ? 'user,assistant,summary,tool_call,tool_result,system'
      : 'user,assistant,summary',
  );

  async function loadLatest() {
    loading.value = true;
    try {
      const r = await store.messages(chatId, { limit: PAGE, types: types.value });
      messages.value = r.messages;
      cursor.value = r.nextCursor;
      hasMore.value = r.hasMore;
      await nextTick();
      if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight;
    } finally {
      loading.value = false;
    }
  }

  async function loadOlder() {
    if (!cursor.value || loading.value) return;
    loading.value = true;
    const prevHeight = scroller.value?.scrollHeight ?? 0;
    try {
      const r = await store.messages(chatId, {
        limit: PAGE,
        cursor: cursor.value,
        types: types.value,
      });
      messages.value = [...r.messages, ...messages.value];
      cursor.value = r.nextCursor;
      hasMore.value = r.hasMore;
      // Keep the viewport anchored where the user was after prepending older msgs.
      await nextTick();
      if (scroller.value) {
        scroller.value.scrollTop = scroller.value.scrollHeight - prevHeight;
      }
    } finally {
      loading.value = false;
    }
  }

  onMounted(() => void loadLatest());
  watch(showTools, loadLatest); // re-fetch from latest when toggling tool events

  return { messages, hasMore, loading, showTools, scroller, loadLatest, loadOlder };
}
