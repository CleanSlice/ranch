import type { IChatReading } from './useChatTranscript';

/**
 * Current user's 👍/👎 per messageId for one chat session. Rating the same
 * value again toggles it off. Loads on mount, when there is a chat to load
 * for (`source.readable`), by the reading it was opened with (CLEAN-269).
 */
export function useChatFeedback(chatId: string, source: IChatReading) {
  const store = useChatStore();

  const feedbackByMsg = ref<Record<string, number>>({});

  async function load() {
    if (!source.readable()) return;
    const fb = await store.feedback(chatId, source.scope());
    const map: Record<string, number> = {};
    for (const f of fb) map[f.messageId] = f.rating;
    feedbackByMsg.value = map;
  }

  async function rate(messageId: string, rating: 1 | -1) {
    const current = feedbackByMsg.value[messageId];
    if (current === rating) {
      await store.unrate(chatId, messageId, source.scope()); // toggle off
      delete feedbackByMsg.value[messageId];
    } else {
      await store.rate(chatId, messageId, rating, source.scope());
      feedbackByMsg.value[messageId] = rating;
    }
  }

  onMounted(() => void load());

  return { feedbackByMsg, rate, load };
}
