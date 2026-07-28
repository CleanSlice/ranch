/**
 * Current user's 👍/👎 per messageId for one chat session. Rating the same
 * value again toggles it off. Loads on mount.
 */
export function useChatFeedback(chatId: string) {
  const store = useChatStore();

  const feedbackByMsg = ref<Record<string, number>>({});

  async function load() {
    const fb = await store.feedback(chatId);
    const map: Record<string, number> = {};
    for (const f of fb) map[f.messageId] = f.rating;
    feedbackByMsg.value = map;
  }

  async function rate(messageId: string, rating: 1 | -1) {
    const current = feedbackByMsg.value[messageId];
    if (current === rating) {
      await store.unrate(chatId, messageId); // toggle off
      delete feedbackByMsg.value[messageId];
    } else {
      await store.rate(chatId, messageId, rating);
      feedbackByMsg.value[messageId] = rating;
    }
  }

  onMounted(() => void load());

  return { feedbackByMsg, rate };
}
