<script setup lang="ts">
import type { ChatExportFormat, IChatMessage } from '#chat/stores/chat';

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

// Current user's 👍/👎 per messageId.
const feedbackByMsg = ref<Record<string, number>>({});
async function loadFeedback() {
  const fb = await chatStore.feedback(props.id);
  const map: Record<string, number> = {};
  for (const f of fb) map[f.messageId] = f.rating;
  feedbackByMsg.value = map;
}
async function onRate(messageId: string, rating: 1 | -1) {
  const current = feedbackByMsg.value[messageId];
  if (current === rating) {
    await chatStore.unrate(props.id, messageId); // toggle off
    delete feedbackByMsg.value[messageId];
  } else {
    await chatStore.rate(props.id, messageId, rating);
    feedbackByMsg.value[messageId] = rating;
  }
}

function onExport(format: ChatExportFormat) {
  void chatStore.exportChat(props.id, format);
}

onMounted(() => {
  if (session.value) {
    void loadLatest();
    void loadFeedback();
  }
});

const heading = computed(() => session.value?.title?.trim() || 'Conversation');
function fmt(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

const sentimentClass = computed(() => {
  switch (session.value?.insights?.sentiment) {
    case 'positive':
      return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400';
    case 'negative':
      return 'bg-rose-500/15 text-rose-700 dark:text-rose-400';
    case 'mixed':
      return 'bg-amber-500/15 text-amber-700 dark:text-amber-400';
    default:
      return 'bg-muted text-muted-foreground';
  }
});
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

        <!-- LLM gist: summary + insights -->
        <div
          v-if="session.summary || session.insights"
          class="mt-3 rounded bg-muted/40 p-3"
        >
          <!-- sentiment / resolved / language sit by the header, apart from topics -->
          <div class="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span class="text-xs font-medium text-muted-foreground">
              Summary &amp; insights
            </span>
            <template v-if="session.insights">
              <span
                class="rounded px-2 py-0.5 capitalize"
                :class="sentimentClass"
              >
                {{ session.insights.sentiment }}
              </span>
              <span
                class="rounded border px-2 py-0.5 capitalize text-muted-foreground"
              >
                {{ session.insights.resolved ? 'resolved' : 'unresolved' }}
              </span>
              <span
                class="rounded border px-2 py-0.5 capitalize text-muted-foreground"
              >
                {{ session.insights.language }}
              </span>
            </template>
          </div>
          <p v-if="session.summary" class="mt-2 text-sm text-muted-foreground">
            {{ session.summary }}
          </p>
          <!-- Topic tags only -->
          <div
            v-if="session.insights?.topics?.length"
            class="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]"
          >
            <span
              v-for="topic in session.insights.topics"
              :key="topic"
              class="rounded border px-2 py-0.5 text-muted-foreground"
            >
              {{ topic }}
            </span>
          </div>
        </div>
      </div>

      <!-- Export controls -->
      <div class="flex items-center justify-end gap-1.5">
        <span class="text-xs text-muted-foreground">Export</span>
        <button
          v-for="f in (['json', 'markdown', 'csv'] as ChatExportFormat[])"
          :key="f"
          type="button"
          class="rounded-md border px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
          @click="onExport(f)"
        >
          {{ f === 'markdown' ? 'MD' : f.toUpperCase() }}
        </button>
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
          :rating="feedbackByMsg[m.id] ?? null"
          @rate="(r: 1 | -1) => onRate(m.id, r)"
        />
      </div>
    </template>
  </div>
</template>
