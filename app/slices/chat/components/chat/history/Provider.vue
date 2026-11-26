<script setup lang="ts">
/**
 * An agent's history in the place of its chat (CLEAN-248): the list, or one
 * closed conversation over it. Which of the two is the caller's to say, and
 * every way out is an event: this slice does not know the agent page's
 * address.
 */
const props = defineProps<{
  agentId: string;
  /** The conversation to read, or null for the list. */
  chatId: string | null;
}>();
const emit = defineEmits<{
  open: [chatId: string];
  'to-chat': [];
  back: [];
}>();

const chatStore = useChatStore();

// Leaving History clears the search: the next visit starts with the whole
// list, and the reload keeps the counter's source unsearched.
onBeforeUnmount(() => {
  if (chatStore.historyStateFor(props.agentId).search) {
    void chatStore.loadHistory(props.agentId);
  }
});
</script>

<template>
  <div class="h-full min-h-0" data-panel-history>
    <!-- Kept mounted under a conversation: its scroll position and its search
         are there when the person comes back. -->
    <ChatHistoryList
      v-show="!chatId"
      :agent-id="agentId"
      @open="(id: string) => emit('open', id)"
      @to-chat="emit('to-chat')"
    />
    <ChatHistoryConversation
      v-if="chatId"
      :key="chatId"
      :chat-id="chatId"
      @back="emit('back')"
      @to-chat="emit('to-chat')"
    />
  </div>
</template>
