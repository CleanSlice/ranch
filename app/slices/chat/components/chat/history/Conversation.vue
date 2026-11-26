<script setup lang="ts">
import type { ChatExportFormat, IChatMessage } from '#chat/stores/chat';
import type { BridleService } from '#bridle/domain';
import { openDocument } from '#bridle/stores/bridle';
import { foldThinking, snippet, type INavMapItem } from '#chat/utils/transcript';

/**
 * One closed conversation, read in the place of the agent's chat
 * (CLEAN-248). The record is the chat store's, by id. The messages, the
 * person's ratings and the optimistic source rating are held here, as they
 * were on the conversation page this was moved from: one reader, so no second
 * copy to disagree with (the waiver in specs/036-agent-history-switch/plan.md).
 */
const props = defineProps<{ chatId: string }>();
const emit = defineEmits<{ back: []; 'to-chat': [] }>();

const chatStore = useChatStore();

const session = computed(() => chatStore.byId[props.chatId] ?? null);

// ── The record ───────────────────────────────────────────────────────────
// 'missing': it does not exist, or it is not this person's — the server
// answers both the same way. 'failed': the request itself did not get through.
const problem = ref<'missing' | 'failed' | null>(null);
// True from the first paint: the record is usually in the store already (the
// list put it there), so the view is drawn at once, and the messages are
// still a request or two away (CLEAN-253).
const opening = ref(true);

async function open() {
  opening.value = true;
  problem.value = null;
  try {
    const found = await chatStore.getMine(props.chatId);
    if (!found) {
      problem.value = 'missing';
      return;
    }
    // The conversation going on now is not read here: it is the chat.
    if (!found.archived) {
      emit('to-chat');
      return;
    }
    void loadLatest();
    void loadFeedback();
  } catch (err) {
    const status = (err as { response?: { status?: number } } | null)?.response?.status;
    problem.value = status === 404 ? 'missing' : 'failed';
  } finally {
    opening.value = false;
  }
}

// ── Messages ─────────────────────────────────────────────────────────────
const PAGE = 50;
const messages = ref<IChatMessage[]>([]);
const cursor = ref<string | null>(null);
const hasMore = ref(false);
const loading = ref(false);
const scroller = ref<HTMLElement | null>(null);

async function loadLatest() {
  loading.value = true;
  try {
    const r = await chatStore.messages(props.chatId, { limit: PAGE });
    messages.value = r.messages;
    cursor.value = r.nextCursor;
    hasMore.value = r.hasMore;
    await nextTick();
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight;
  } catch {
    problem.value = 'failed';
  } finally {
    loading.value = false;
  }
}

async function loadOlder() {
  if (!cursor.value || loading.value) return;
  loading.value = true;
  const prevHeight = scroller.value?.scrollHeight ?? 0;
  try {
    const r = await chatStore.messages(props.chatId, {
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

// The transcript is read from storage and takes seconds for a long
// conversation. Until its first page is here the feed and the Overview's
// Navigation show placeholders in their own places, so the screen is never
// blank and nothing jumps when the messages land (CLEAN-253). Loading older
// messages is not this: the feed is full then, and its button says so.
const loadingFirst = computed(
  () => (opening.value || loading.value) && !messages.value.length,
);
// Widths of the placeholder bubbles, alternating sides like a conversation.
const PLACEHOLDER_BUBBLES = ['w-2/5', 'w-3/5', 'w-1/3', 'w-1/2', 'w-2/5'];

// Current user's 👍/👎 per messageId.
const feedbackByMsg = ref<Record<string, number>>({});
async function loadFeedback() {
  try {
    const fb = await chatStore.feedback(props.chatId);
    const map: Record<string, number> = {};
    for (const f of fb) map[f.messageId] = f.rating;
    feedbackByMsg.value = map;
  } catch {
    // The conversation reads the same without the marks.
  }
}
async function onRate(messageId: string, rating: 1 | -1) {
  const current = feedbackByMsg.value[messageId];
  if (current === rating) {
    await chatStore.unrate(props.chatId, messageId); // toggle off
    delete feedbackByMsg.value[messageId];
  } else {
    await chatStore.rate(props.chatId, messageId, rating);
    feedbackByMsg.value[messageId] = rating;
  }
}

// ── Cited sources (CLEAN-138) ──────────────────────────────────
// The history draws the live chat's list, so opening and rating go through
// the same bridle service; this view's own message list is what gets patched.
const bridle = useNuxtApp().$bridleService as BridleService;
const sourceNotice = ref<string | null>(null);

async function onOpenSource(messageId: string, n: number) {
  const agentId = session.value?.agentId;
  if (!agentId) return;
  try {
    openDocument(await bridle.openCitedSource(agentId, messageId, n));
  } catch (err) {
    const status = (err as { response?: { status?: number } } | null)?.response?.status;
    sourceNotice.value =
      status === 403
        ? 'message.source_locked'
        : status === 410
          ? 'message.source_gone'
          : 'message.source_open_failed';
  }
}

async function onRateSource(messageId: string, n: number, rating: 1 | -1 | null) {
  const agentId = session.value?.agentId;
  const index = messages.value.findIndex((m) => m.id === messageId);
  const message = messages.value[index];
  if (!agentId || !message?.sources) return;
  const before = message.sources;
  const patch = (value: 1 | -1 | undefined) =>
    before.map((s) => (s.n === n ? { ...s, myRating: value } : s));
  messages.value[index] = { ...message, sources: patch(rating ?? undefined) };
  try {
    await bridle.rateCitedSource(agentId, messageId, n, rating);
  } catch {
    // Put the list back exactly as it was and say so.
    const current = messages.value[index];
    if (current) messages.value[index] = { ...current, sources: before };
    sourceNotice.value = 'message.source_rating_failed';
  }
}

function onExport(format: ChatExportFormat) {
  void chatStore.exportChat(props.chatId, format);
}

const heading = computed(() => {
  const title = session.value?.title?.trim();
  if (title) return title;
  const summary = session.value?.summary?.trim();
  if (summary) return summary.length > 80 ? `${summary.slice(0, 80)}…` : summary;
  return null;
});

// Narration goes into a thinking block above its reply, as it did live (CLEAN-242).
const items = computed(() => foldThinking(messages.value));

const navItems = computed<INavMapItem[]>(() =>
  messages.value
    .filter((m) => m.role === 'user' || (m.role === 'assistant' && !m.interim))
    .map((m) => ({ id: m.id, isUser: m.role === 'user', snippet: snippet(m.text) }))
    .filter((mi) => mi.snippet.length > 0),
);

// ── Overview: beside the messages, or over them ─────────────────────────
// 300 px for the Overview, a 24 px gap, and about 556 px left for the
// messages: the narrowest the bubbles stay readable at their 85 % maximum
// width. Measured on this view, not the window: the same window holds a wide
// panel in the list view and a narrow one beside the orbit map.
const OVERVIEW_BESIDE_MIN_PX = 880;

const root = ref<HTMLElement | null>(null);
const beside = ref(false);
const overviewOpen = ref(false);
const overviewToggle = ref<HTMLButtonElement | null>(null);
let resize: ResizeObserver | null = null;

function closeOverview(returnFocus = true) {
  if (!overviewOpen.value) return;
  overviewOpen.value = false;
  if (returnFocus) void nextTick(() => overviewToggle.value?.focus());
}

function onJump(id: string) {
  // Over the messages it is in the way of the one that was asked for.
  closeOverview(false);
  void nextTick(() => {
    scroller.value
      ?.querySelector(`[data-msg-id="${id}"]`)
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
}

// Escape closes the Overview shown over the messages and nothing else; the
// panel's own listener sees it open and leaves the key alone.
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !overviewOpen.value || beside.value) return;
  event.preventDefault();
  closeOverview();
}

onMounted(() => {
  void open();
  window.addEventListener('keydown', onKeydown, true);
  if (root.value && typeof ResizeObserver !== 'undefined') {
    resize = new ResizeObserver(([entry]) => {
      if (!entry) return;
      beside.value = entry.contentRect.width >= OVERVIEW_BESIDE_MIN_PX;
      // Room appeared: it stands beside the messages now, nothing to close.
      if (beside.value) overviewOpen.value = false;
    });
    resize.observe(root.value);
  }
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true);
  resize?.disconnect();
});
</script>

<template>
  <div ref="root" class="flex h-full min-h-0 flex-col" data-history-conversation>
    <!-- Not found / not owned, or the request failed -->
    <div
      v-if="problem"
      class="flex flex-1 flex-col items-center justify-center gap-1 px-4 text-center"
      :data-conversation-state="problem === 'missing' ? 'not-found' : 'error'"
      role="status"
    >
      <template v-if="problem === 'missing'">
        <h2 class="text-base font-semibold">{{ $t('session.not_found_title') }}</h2>
        <p class="text-sm text-muted-foreground">{{ $t('session.not_found_hint') }}</p>
      </template>
      <template v-else>
        <h2 class="text-base font-semibold">{{ $t('history.load_failed') }}</h2>
        <button
          type="button"
          class="mt-2 rounded-full border px-3.5 py-1.5 text-xs font-medium transition hover:bg-muted"
          @click="open"
        >
          {{ $t('history.retry') }}
        </button>
      </template>
      <button
        type="button"
        class="mt-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        @click="emit('back')"
      >
        <Icon name="arrow-left" :size="15" /> {{ $t('history.back') }}
      </button>
    </div>

    <!-- Not loaded yet, or the running conversation on its way to the chat. -->
    <div
      v-else-if="!session || !session.archived"
      class="flex flex-1 items-center justify-center"
      aria-busy="true"
    >
      <Icon name="loader-2" :size="20" class="animate-spin text-muted-foreground" />
    </div>

    <template v-else>
      <!-- The bar: the way back, what this is, and the Overview when it does
           not fit beside the messages. One line at any width. -->
      <div
        class="flex min-h-11 shrink-0 items-center gap-2.5 border-b bg-card/60 px-3 py-1.5"
        data-conversation-bar
      >
        <button
          type="button"
          class="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full pl-2 pr-2.5 text-[12.5px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
          @click="emit('back')"
        >
          <Icon name="arrow-left" :size="14" /> {{ $t('history.back') }}
        </button>
        <span class="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
        <h2 class="min-w-0 flex-1 truncate text-[13px] font-semibold">
          {{ heading ?? $t('session.fallback_title') }}
        </h2>
        <span
          class="shrink-0 rounded-full border px-1.5 py-px text-[10.5px] text-muted-foreground"
        >
          {{ $t('session.closed') }}
        </span>
        <button
          v-if="!beside"
          ref="overviewToggle"
          type="button"
          class="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs transition"
          :class="
            overviewOpen
              ? 'border-primary/60 bg-primary/10 text-primary'
              : 'text-muted-foreground hover:text-foreground'
          "
          :aria-expanded="overviewOpen"
          :title="$t(overviewOpen ? 'session.overview_hide' : 'session.overview_show')"
          data-overview-toggle
          @click="overviewOpen ? closeOverview() : (overviewOpen = true)"
        >
          <Icon name="panel-right" :size="13" />
          <span class="max-[420px]:sr-only">{{ $t('session.overview') }}</span>
        </button>
      </div>

      <div class="relative flex min-h-0 flex-1">
        <!-- Messages -->
        <div ref="scroller" class="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-4">
          <div class="mx-auto flex w-full max-w-3xl flex-col gap-4">
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

            <!-- The first page is on its way. -->
            <div
              v-if="loadingFirst"
              class="flex flex-col gap-4"
              role="status"
              aria-busy="true"
              data-conversation-state="loading"
            >
              <span class="sr-only">{{ $t('session.loading') }}</span>
              <div
                v-for="(width, i) in PLACEHOLDER_BUBBLES"
                :key="i"
                class="flex items-start gap-2.5"
                :class="i % 2 === 0 ? 'justify-end' : undefined"
                aria-hidden="true"
              >
                <div
                  v-if="i % 2 === 1"
                  class="h-7 w-7 shrink-0 animate-pulse rounded-full bg-muted"
                />
                <div
                  class="h-11 animate-pulse rounded-2xl"
                  :class="[width, i % 2 === 0 ? 'bg-primary/20' : 'bg-muted']"
                />
              </div>
            </div>

            <div
              v-else-if="!messages.length"
              class="py-16 text-center text-sm text-muted-foreground"
            >
              {{ $t('session.no_messages') }}
            </div>

            <!-- A cited source could not be opened or rated (CLEAN-138). -->
            <div
              v-if="sourceNotice"
              class="mx-auto flex max-w-[85%] items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-xs text-destructive"
              role="status"
              aria-live="polite"
            >
              <span class="flex-1">{{ $t(sourceNotice) }}</span>
              <button
                type="button"
                class="underline underline-offset-2"
                @click="sourceNotice = null"
              >
                {{ $t('message.notice_dismiss') }}
              </button>
            </div>

            <template v-for="item in items" :key="item.key">
              <!-- Narration with no reply after it -->
              <div v-if="item.message === null" class="pl-11">
                <BridleChatThinking :block="item.thinking!" :agent-name="$t('chat.agent')" />
              </div>
              <div v-else :data-msg-id="item.message.id" class="scroll-mt-2">
                <ChatMessageBubble
                  :message="item.message"
                  :thinking="item.thinking"
                  :rating="feedbackByMsg[item.message.id] ?? null"
                  @rate="(r: 1 | -1) => onRate(item.message!.id, r)"
                  @open-source="(n: number) => onOpenSource(item.message!.id, n)"
                  @rate-source="(n: number, r: 1 | -1 | null) => onRateSource(item.message!.id, n, r)"
                />
              </div>
            </template>
          </div>
        </div>

        <!-- Overview. With room: a column to the right, always there.
             Without: over the messages, when asked for. -->
        <aside
          v-if="beside || overviewOpen"
          class="overflow-y-auto p-3"
          :class="
            beside
              ? 'w-[324px] shrink-0 border-l'
              : 'absolute inset-0 z-20 bg-background'
          "
          :aria-label="$t('session.overview')"
          :data-overview-mode="beside ? 'column' : 'overlay'"
        >
          <div :class="beside ? undefined : 'mx-auto w-full max-w-md'">
            <ChatHistoryOverview
              :session="session"
              :nav-items="navItems"
              :nav-pending="loadingFirst"
              @jump="onJump"
              @export="onExport"
            />
          </div>
        </aside>
      </div>

      <!-- Where the composer was: this one is only read. -->
      <div class="shrink-0 border-t px-4 pb-3.5 pt-2.5" data-read-only>
        <div
          class="mx-auto flex min-h-12 w-full max-w-3xl flex-wrap items-center gap-x-3.5 gap-y-2 rounded-2xl border border-dashed px-4 py-2 text-[13px] text-muted-foreground"
        >
          <span class="flex min-w-[200px] flex-1 items-center gap-2">
            <Icon name="lock" :size="14" class="shrink-0" />
            {{ $t('session.read_only') }}
          </span>
          <button
            type="button"
            class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-primary px-3.5 text-xs font-semibold text-primary-foreground transition hover:opacity-95"
            @click="emit('to-chat')"
          >
            <Icon name="message-square" :size="13" />
            {{ $t('session.to_current') }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
