<script setup lang="ts">
import { groupClosed, type HistoryGroupKey } from '#chat/utils/historyGroups';

/**
 * One agent's conversations (CLEAN-248): the one going on now, then the
 * closed ones under Today, This week and Earlier, with a search over all of
 * them. It renders the chat store's records by id and holds nothing of its
 * own but the text being typed.
 */
const props = defineProps<{ agentId: string }>();
const emit = defineEmits<{ open: [chatId: string]; 'to-chat': [] }>();

const chatStore = useChatStore();

const state = computed(() => chatStore.historyStateFor(props.agentId));
const closed = computed(() => chatStore.closedFor(props.agentId));
const groups = computed(() => groupClosed(closed.value));

// The running conversation is one row and is not part of the searched
// request, so the same text is applied to it here.
const current = computed(() => {
  const term = state.value.search.trim().toLowerCase();
  const rows = chatStore.currentFor(props.agentId);
  if (!term) return rows;
  return rows.filter((s) =>
    `${s.title ?? ''} ${s.preview ?? ''}`.toLowerCase().includes(term),
  );
});

// Copy decided in script travels as a key (docs/i18n.md).
const GROUP_KEYS: Record<HistoryGroupKey, string> = {
  today: 'history.group_today',
  this_week: 'history.group_this_week',
  earlier: 'history.group_earlier',
};

/** What stands in the place of the rows when there are none. */
const blank = computed<'loading' | 'error' | 'no-match' | 'empty' | null>(() => {
  if (current.value.length || closed.value.length) return null;
  if (state.value.status === 'loading') return 'loading';
  if (state.value.status === 'error') return 'error';
  return state.value.search ? 'no-match' : 'empty';
});

// ── Search ───────────────────────────────────────────────────────────────
// A pause in typing, well inside the second a result is allowed to take.
const SEARCH_DEBOUNCE_MS = 250;

// Restored from the store: coming back from a conversation shows the same
// search and its results.
const text = ref(chatStore.historyStateFor(props.agentId).search);
const searchEl = ref<HTMLInputElement | null>(null);
let searchTimer: ReturnType<typeof setTimeout> | null = null;

watch(text, (value) => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    void chatStore.loadHistory(props.agentId, value.trim());
  }, SEARCH_DEBOUNCE_MS);
});

// Escape empties a search that has text; only an empty field lets the key
// through to the panel, which steps back with it.
function onSearchKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !text.value) return;
  event.preventDefault();
  text.value = '';
}

// ── Sync ─────────────────────────────────────────────────────────────────
const syncing = ref(false);
async function onSync() {
  if (syncing.value) return;
  syncing.value = true;
  try {
    await chatStore.syncHistory(props.agentId);
  } finally {
    syncing.value = false;
  }
}

function onRetry() {
  void chatStore.refreshHistory(props.agentId);
}

// ── Further pages ────────────────────────────────────────────────────────
// How far below the visible rows the end may be when the next page is asked
// for: about three rows, so the list never visibly runs out while scrolling.
const LOAD_AHEAD_PX = 240;

const scroller = ref<HTMLElement | null>(null);
const sentinel = ref<HTMLElement | null>(null);

function loadMoreIfNear() {
  const box = scroller.value;
  const end = sentinel.value;
  if (!box || !end) return;
  // Hidden while a conversation is read: every rectangle is zero there, and
  // "near the end" would be true for ever.
  if (box.offsetParent === null) return;
  if (!state.value.hasMore || state.value.moreFailed || state.value.status !== 'idle') return;
  if (end.getBoundingClientRect().top > box.getBoundingClientRect().bottom + LOAD_AHEAD_PX) return;
  void chatStore.loadMoreHistory(props.agentId);
}

// A page that does not fill the panel leaves the end in view with nothing to
// scroll: look again whenever rows arrive or a load settles.
watch(
  () => [closed.value.length, state.value.status] as const,
  () => void nextTick(loadMoreIfNear),
);

function onMoreRetry() {
  void chatStore.loadMoreHistory(props.agentId);
}

onMounted(() => {
  searchEl.value?.focus();
  // Opening History is a fresh look: the running conversation's row and the
  // counter are as old as the last load otherwise.
  void chatStore.refreshHistory(props.agentId);
});
onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer);
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" data-history-list>
    <div class="shrink-0 px-4 pt-4">
      <div class="mx-auto flex w-full max-w-3xl items-center gap-2">
        <label
          class="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full border bg-card px-3 text-[13px] text-muted-foreground transition-colors focus-within:border-primary/60 focus-within:text-foreground"
        >
          <Icon name="search" :size="14" class="shrink-0" />
          <input
            ref="searchEl"
            v-model="text"
            type="search"
            class="history-search min-w-0 flex-1 bg-transparent text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
            :placeholder="$t('history.search')"
            :aria-label="$t('history.search')"
            data-history-search
            @keydown="onSearchKeydown"
          />
        </label>
        <button
          type="button"
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background text-foreground transition hover:bg-muted disabled:opacity-60"
          :title="$t(syncing ? 'history.syncing' : 'history.sync')"
          :disabled="syncing"
          data-history-sync
          @click="onSync"
        >
          <Icon name="refresh-cw" :size="14" :class="syncing ? 'animate-spin' : undefined" />
          <span class="sr-only">{{ $t(syncing ? 'history.syncing' : 'history.sync') }}</span>
        </button>
      </div>
    </div>

    <div
      ref="scroller"
      class="min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-3"
      @scroll.passive="loadMoreIfNear"
    >
      <div class="mx-auto flex w-full max-w-3xl flex-col gap-2">
        <!-- First load -->
        <template v-if="blank === 'loading'">
          <div
            v-for="i in 4"
            :key="i"
            class="flex items-start gap-3 rounded-xl border bg-card px-3 py-2.5"
            data-history-state="loading"
            aria-hidden="true"
          >
            <div class="h-8 w-8 shrink-0 animate-pulse rounded-[9px] bg-muted" />
            <div class="flex-1 space-y-2 py-0.5">
              <div class="h-3.5 w-40 max-w-full animate-pulse rounded bg-muted" />
              <div class="h-3 w-64 max-w-full animate-pulse rounded bg-muted/70" />
            </div>
          </div>
        </template>

        <!-- Nothing to list, and why -->
        <div
          v-else-if="blank"
          class="px-4 py-10 text-center"
          :data-history-state="blank"
          role="status"
        >
          <template v-if="blank === 'error'">
            <p class="text-sm font-medium">{{ $t('history.load_failed') }}</p>
            <button
              type="button"
              class="mt-3 rounded-full border px-3.5 py-1.5 text-xs font-medium transition hover:bg-muted"
              @click="onRetry"
            >
              {{ $t('history.retry') }}
            </button>
          </template>
          <template v-else-if="blank === 'no-match'">
            <p class="text-sm font-medium">{{ $t('history.search_none') }}</p>
            <p class="mt-1 text-xs text-muted-foreground">{{ $t('history.search_scope') }}</p>
          </template>
          <template v-else>
            <div
              class="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground"
            >
              <Icon name="history" :size="20" />
            </div>
            <p class="mt-3 text-sm font-medium">{{ $t('history.empty_agent_title') }}</p>
            <p class="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
              {{ $t('history.empty_agent_hint') }}
            </p>
          </template>
        </div>

        <template v-else>
          <!-- The list is on screen but its reload failed: say so, keep it. -->
          <p
            v-if="state.status === 'error'"
            class="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-xs text-destructive"
            role="status"
          >
            <span class="flex-1">{{ $t('history.load_failed') }}</span>
            <button type="button" class="underline underline-offset-2" @click="onRetry">
              {{ $t('history.retry') }}
            </button>
          </p>

          <ChatHistoryRow
            v-for="session in current"
            :key="session.id"
            :session="session"
            @pick="emit('to-chat')"
          />

          <template v-for="group in groups" :key="group.key">
            <h3
              class="mt-2 px-0.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80"
              data-history-group
            >
              {{ $t(GROUP_KEYS[group.key]) }}
            </h3>
            <ChatHistoryRow
              v-for="session in group.items"
              :key="session.id"
              :session="session"
              @pick="emit('open', session.id)"
            />
          </template>

          <!-- The end of what is loaded. Reaching it asks for the next page. -->
          <div v-if="state.hasMore" ref="sentinel" class="py-2 text-center" data-history-more>
            <button
              v-if="state.moreFailed"
              type="button"
              class="rounded-full border px-3.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
              @click="onMoreRetry"
            >
              {{ $t('history.more_failed') }} · {{ $t('history.retry') }}
            </button>
            <Icon
              v-else
              name="loader-2"
              :size="16"
              class="inline-block animate-spin text-muted-foreground"
            />
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* The field has its own frame; the browser's clear button and ring are not
   drawn inside it. */
.history-search::-webkit-search-cancel-button {
  appearance: none;
}
</style>
