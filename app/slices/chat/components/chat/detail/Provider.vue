<script setup lang="ts">
import type { ChatExportFormat, IChatMessage } from '#chat/stores/chat';
import { snippet, type INavMapItem } from '#chat/utils/transcript';

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

const { locale } = useI18n();

const heading = computed(() => session.value?.title?.trim() || null);
function fmt(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString(locale.value) : '—';
}

const navItems = computed<INavMapItem[]>(() =>
  messages.value
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ id: m.id, isUser: m.role === 'user', snippet: snippet(m.text) }))
    .filter((mi) => mi.snippet.length > 0),
);

function onJump(id: string) {
  scroller.value
    ?.querySelector(`[data-msg-id="${id}"]`)
    ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

const sentimentVariant: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  positive: 'secondary',
  neutral: 'default',
  negative: 'destructive',
  mixed: 'secondary',
};
</script>

<template>
  <div class="flex w-full flex-col gap-4">
    <!-- Not found / not owned -->
    <div
      v-if="!session && !sessionPending"
      class="rounded-xl border border-dashed bg-card/40 p-12 text-center"
    >
      <h2 class="text-base font-semibold">{{ $t('session.not_found_title') }}</h2>
      <p class="mt-1 text-sm text-muted-foreground">
        {{ $t('session.not_found_hint') }}
      </p>
    </div>

    <template v-else-if="session">
      <!-- Slim header -->
      <div class="flex items-center gap-3 border-b pb-3">
        <NuxtLink
          to="/chats"
          class="inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <Icon name="arrow-left" :size="16" /> {{ $t('history.title') }}
        </NuxtLink>
        <div class="h-[18px] w-px bg-border" />
        <span class="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">
          {{ heading ?? $t('session.fallback_title') }}
        </span>
        <button
          type="button"
          class="rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
          :disabled="loading"
          @click="loadLatest"
        >
          {{ $t('session.refresh') }}
        </button>
      </div>

      <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <!-- Feed -->
        <div
          ref="scroller"
          class="flex h-[calc(100vh-14rem)] min-h-0 flex-col gap-4 overflow-y-auto pr-1"
        >
          <div v-if="hasMore" class="flex justify-center">
            <button
              type="button"
              class="rounded-md border px-3 py-1.5 text-sm text-muted-foreground transition hover:text-foreground disabled:opacity-50"
              :disabled="loading"
              @click="loadOlder"
            >
              {{ $t(loading ? 'session.loading' : 'session.load_older') }}
            </button>
          </div>

          <div
            v-if="!messages.length && !loading"
            class="py-16 text-center text-sm text-muted-foreground"
          >
            {{ $t('session.no_messages') }}
          </div>

          <div
            v-for="m in messages"
            :key="m.id"
            :data-msg-id="m.id"
            class="scroll-mt-2"
          >
            <ChatMessageBubble
              :message="m"
              :rating="feedbackByMsg[m.id] ?? null"
              @rate="(r: 1 | -1) => onRate(m.id, r)"
            />
          </div>
        </div>

        <!-- Right rail -->
        <div
          class="flex flex-col gap-3.5 lg:max-h-[calc(100vh-14rem)] lg:overflow-y-auto"
        >
          <!-- Meta card -->
          <div
            class="flex flex-col gap-2.5 rounded-xl border border-border/70 bg-card px-4 py-3.5"
          >
            <div class="flex items-center justify-between gap-3 text-[12.5px]">
              <span class="text-muted-foreground/70">
                {{ $t('session.meta_messages') }}
              </span>
              <span class="font-medium">{{ session.messageCount }}</span>
            </div>
            <div class="flex items-center justify-between gap-3 text-[12.5px]">
              <span class="text-muted-foreground/70">
                {{ $t('session.meta_activity') }}
              </span>
              <span class="font-medium">{{ fmt(session.lastMessageAt) }}</span>
            </div>
          </div>

          <!-- Summary & insights (read-only) -->
          <div
            class="flex flex-col gap-2 rounded-xl border border-border/70 bg-card px-4 py-3.5"
          >
            <span
              class="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70"
            >
              {{ $t('session.insights_title') }}
            </span>
            <div v-if="session.insights" class="flex flex-wrap items-center gap-1.5">
              <Badge
                :variant="sentimentVariant[session.insights.sentiment] ?? 'secondary'"
                class="capitalize"
              >
                {{ session.insights.sentiment }}
              </Badge>
              <Badge variant="outline" class="capitalize">
                {{ $t(session.insights.resolved ? 'session.resolved' : 'session.unresolved') }}
              </Badge>
              <Badge variant="outline" class="capitalize">
                {{ session.insights.language }}
              </Badge>
            </div>
            <p
              v-if="session.summary"
              class="text-[12.5px] leading-relaxed text-muted-foreground"
            >
              {{ session.summary }}
            </p>
            <p v-else class="text-[12.5px] leading-relaxed text-muted-foreground/70">
              {{ $t('session.no_summary') }}
            </p>
            <div
              v-if="session.insights?.topics?.length"
              class="flex flex-wrap items-center gap-1.5"
            >
              <Badge
                v-for="topic in session.insights.topics"
                :key="topic"
                variant="outline"
                class="capitalize"
              >
                {{ topic }}
              </Badge>
            </div>
          </div>

          <ChatDetailNavMap :items="navItems" @jump="onJump" />

          <!-- Export -->
          <div class="flex items-center gap-1.5 px-1">
            <span class="mr-1 text-xs text-muted-foreground">
              {{ $t('session.export') }}
            </span>
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
        </div>
      </div>
    </template>
  </div>
</template>
