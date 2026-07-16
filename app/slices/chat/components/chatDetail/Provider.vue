<script setup lang="ts">
import type { IChatMessage } from '#chat/stores/chat';

const props = defineProps<{ id: string }>();
const chatStore = useChatStore();

const { data: session, pending: sessionPending } = await useAsyncData(
  `my-chat-${props.id}`,
  () => chatStore.getMine(props.id),
);

const PAGE = 50;
const messages = ref<IChatMessage[]>([]);
const cursor = ref<string | null>(null);
const hasMore = ref(false);
const loading = ref(false);
const scroller = ref<HTMLElement | null>(null);

async function loadLatest() {
  loading.value = true;
  try {
    const r = await chatStore.messages(props.id, { limit: PAGE });
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
    const r = await chatStore.messages(props.id, {
      limit: PAGE,
      cursor: cursor.value,
    });
    messages.value = [...r.messages, ...messages.value];
    cursor.value = r.nextCursor;
    hasMore.value = r.hasMore;
    // Keep the viewport anchored after prepending older messages.
    await nextTick();
    if (scroller.value) {
      scroller.value.scrollTop = scroller.value.scrollHeight - prevHeight;
    }
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  if (session.value) void loadLatest();
});

const heading = computed(() => session.value?.title?.trim() || 'Conversation');
function fmt(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}
</script>

<template>
  <div class="mx-auto flex max-w-3xl flex-col gap-4">
    <NuxtLink
      to="/chats"
      class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <Icon name="arrow-left" :size="16" /> History
    </NuxtLink>

    <!-- Not found / not owned -->
    <div
      v-if="!session && !sessionPending"
      class="rounded-xl border border-dashed bg-card/40 p-12 text-center"
    >
      <h2 class="text-base font-semibold">Conversation not found</h2>
      <p class="mt-1 text-sm text-muted-foreground">
        It may have been removed, or it isn't one of yours.
      </p>
    </div>

    <template v-else-if="session">
      <!-- Meta header -->
      <div class="rounded-md border bg-card p-4">
        <span class="text-lg font-semibold">{{ heading }}</span>
        <div
          class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
        >
          <span>{{ session.messageCount }} messages</span>
          <span>Last activity {{ fmt(session.lastMessageAt) }}</span>
        </div>
        <!-- LLM gist -->
        <div v-if="session.summary" class="mt-3 rounded bg-muted/40 p-3">
          <span class="text-xs font-medium text-muted-foreground">Summary</span>
          <p class="mt-1 text-sm text-muted-foreground">{{ session.summary }}</p>
        </div>
      </div>

      <!-- Transcript -->
      <div
        ref="scroller"
        class="flex max-h-[70vh] flex-col gap-3 overflow-y-auto rounded-md border bg-card p-4"
      >
        <div v-if="hasMore" class="flex justify-center">
          <button
            type="button"
            class="rounded-md border px-3 py-1.5 text-sm text-muted-foreground transition hover:text-foreground disabled:opacity-50"
            :disabled="loading"
            @click="loadOlder"
          >
            {{ loading ? 'Loading…' : 'Load older' }}
          </button>
        </div>

        <div
          v-if="!messages.length && !loading"
          class="py-10 text-center text-sm text-muted-foreground"
        >
          No messages in this conversation.
        </div>

        <ChatMessageBubble
          v-for="m in messages"
          :key="m.id"
          :message="m"
        />
      </div>
    </template>
  </div>
</template>
