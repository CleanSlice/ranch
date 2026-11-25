<script setup lang="ts">
import {
  BridleChannelStates,
  type IBridleConversation,
} from '#bridle/stores/bridle';
import { useLimitCountdown } from '#bridle/composables/useLimitCountdown';
import { buildChatFlow } from '#bridle/utils/chatFlow';
import { noticeParams } from '#bridle/utils/noticeParams';
import { toolNotice } from '#bridle/utils/toolNotice';
import { canTake, held } from '#bridle/utils/queue';
import type { QueueAgentStates } from '#bridle/stores/bridle';
import { useFormat } from '#common/composables/useFormat';

const props = withDefaults(
  defineProps<{
    agentId: string | null;
    /**
     * Which conversation this chat is. Defaults to `{ key: agentId, agentId }`,
     * which is what the console wants — the share page passes a descriptor
     * with its own key and the visitor's share credentials.
     */
    conversation?: IBridleConversation;
    title?: string;
    subtitle?: string;
    /** Hide the inner header — useful when the parent already shows agent identity. */
    showHeader?: boolean;
    /**
     * The host's own reading of the agent's tool servers (CLEAN-245), for a
     * viewer who may manage the agent: it may name a server. As keys — this
     * component renders them. Absent or null for everyone else, who gets the
     * line this chat words itself from the hub's bare word.
     */
    toolView?: {
      kind: 'connecting' | 'limited';
      labelKey: string;
      lines: {
        key: string;
        params: Record<string, string | number>;
        wait?: { key: string; count: number };
      }[];
    } | null;
    /**
     * What the host knows of the agent beyond the hub's word (CLEAN-245): it
     * is being started, or it failed, or it was stopped. Null when it runs,
     * and on a page that knows nothing of it (a share link, the landing).
     */
    agentState?: QueueAgentStates;
  }>(),
  { showHeader: true, toolView: null, agentState: null },
);
const bridleStore = useBridleStore();
// The locale itself, handed to the pure `buildChatFlow` for the date on a day
// separator; every string still goes through `$t`.
const { locale } = useI18n();
const format = useFormat();

/**
 * The descriptor every store call goes through. `withDefaults` can't derive a
 * default from a sibling prop, so the fallback is computed here.
 */
const activeConversation = computed<IBridleConversation | null>(() => {
  if (props.conversation) return props.conversation;
  return props.agentId ? { key: props.agentId, agentId: props.agentId } : null;
});

// Replay persisted conversation so the chat isn't blank after a refresh.
// Watcher (not just onMounted) covers the case where the parent swaps agentId
// without remounting this component. Keyed on `key` so a parent re-rendering
// with a fresh descriptor object doesn't re-run this.
watch(
  () => activeConversation.value?.key,
  (key) => {
    const conversation = activeConversation.value;
    if (key && conversation) bridleStore.hydrate(conversation);
  },
  { immediate: true },
);

// The live channel follows the conversation: held from the moment the key
// settles, let go when it changes or the chat unmounts. Held, not owned — the
// landing hero and the agent page show the same conversation, and the store
// keeps one socket open across the handoff between them (CLEAN-102).
watch(
  () => activeConversation.value?.key,
  (_key, _old, onCleanup) => {
    const conversation = activeConversation.value;
    if (!conversation) return;
    void bridleStore.acquire(conversation);
    onCleanup(() => bridleStore.release(conversation));
  },
  { immediate: true },
);

const messages = computed(() => {
  const key = activeConversation.value?.key;
  return key ? bridleStore.messagesFor(key) : [];
});
const sending = computed(() => {
  const key = activeConversation.value?.key;
  return key ? bridleStore.isPending(key) : false;
});
const error = computed(() => {
  const key = activeConversation.value?.key;
  return key ? bridleStore.errorFor(key) : null;
});
const thinkingBlocks = computed(() => {
  const key = activeConversation.value?.key;
  return key ? bridleStore.thinkingFor(key) : [];
});
const hasOpenThinking = computed(() => {
  const key = activeConversation.value?.key;
  return key ? bridleStore.hasOpenThinking(key) : false;
});
/**
 * Shown only after a connection existed and went away: on first load the
 * socket is still on its way, and shouting "reconnecting" at a page that just
 * opened would be wrong.
 */
const reconnecting = computed(() => {
  const key = activeConversation.value?.key;
  return key
    ? bridleStore.connectionFor(key) === BridleChannelStates.Offline &&
        messages.value.length > 0
    : false;
});

// ── Tool servers (CLEAN-245) ──────────────────────────────────
// The agent is up and some of its tool servers are not: said in one line
// above the composer, which stays usable either way. A share visitor and a
// landing visitor get it too — this is the component they all render.
const ownToolNotice = computed(() => {
  if (props.toolView) return null;
  const key = activeConversation.value?.key;
  return key ? toolNotice(bridleStore.toolsFor(key)) : null;
});

// ── Chat flow ─────────────────────────────────────────────────
// Messages and thinking blocks interleaved in the order they ARRIVED, so a
// frozen block stays above the answer it produced and the live one always
// sits last. Never by timestamp: the person's clock and the agent's disagree,
// and sorting by them is what used to put an answer above its question.

const chatFlow = computed(() =>
  buildChatFlow(messages.value, thinkingBlocks.value, {
    locale: locale.value,
    now: Date.now(),
  }),
);

/** Long form for the separator's tooltip; the label may just say "Today". */
function dayTitle(ts: number): string {
  return format.fullDate(ts);
}

/** Null when the agent has no name to show; the template then says "Agent"
 *  in the customer's language. */
const agentLabel = computed(() => props.title?.trim() || props.agentId || null);

function dismissError() {
  const conversation = activeConversation.value;
  if (conversation) bridleStore.dismissError(conversation);
}

// ── Scrolling ─────────────────────────────────────────────────
// One rule (CLEAN-102, research D8): sending always goes to the bottom;
// incoming content is followed only by a reader who is already there.

const scrollEl = ref<HTMLElement | null>(null);
/** How close to the end still counts as "reading the newest message". */
const NEAR_BOTTOM_PX = 80;

function isNearBottom(): boolean {
  const el = scrollEl.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
}

function scrollToBottom() {
  const el = scrollEl.value;
  if (!el) return;
  requestAnimationFrame(() => {
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  });
}

// ── Earlier messages (CLEAN-136) ──────────────────────────────
// The chat opens on the newest page of the conversation as the server holds
// it; older pages come in at the top, one at a time, when the reader gets
// there.

const hasOlder = computed(() => {
  const key = activeConversation.value?.key;
  return key ? bridleStore.hasOlder(key) : false;
});
const loadingOlder = computed(() => {
  const key = activeConversation.value?.key;
  return key ? bridleStore.isLoadingOlder(key) : false;
});

/** How close to the top counts as "asking for what came before". */
const NEAR_TOP_PX = 8;

async function loadOlder() {
  const el = scrollEl.value;
  const conversation = activeConversation.value;
  if (!el || !conversation || !hasOlder.value || loadingOlder.value) return;
  // Measured before the page lands: what was added above is exactly how far
  // the message being read has moved down.
  const before = el.scrollHeight;
  const added = await bridleStore.loadOlder(conversation);
  if (!added) return;
  await nextTick();
  el.scrollTop += el.scrollHeight - before;
}

function onScroll() {
  const el = scrollEl.value;
  if (el && el.scrollTop <= NEAR_TOP_PX) void loadOlder();
}

// ── Request limit (CLEAN-224) ─────────────────────────────────
// The agent's limit is full: the composer carries a notice with the wait and
// sends nothing until it ends. Counted here, once per chat, so the notice
// outlives the composer being remounted or swapped for the drop zone. The
// landing chat, the share page and the console chat all render this
// component, which is why they all get it.

const { countdown: limit } = useLimitCountdown(
  () => activeConversation.value?.agentId,
);
/** What every control the limit turns off points at with `aria-describedby`. */
const limitNoticeId = useId();
/** The notice's id while sending is paused; undefined otherwise. */
const sendPausedBy = computed(() =>
  limit.value?.state === 'waiting' ? limitNoticeId : undefined,
);

/** Bumped by a reset; the composer is keyed on it and remounts empty. */
const composerEpoch = computed(() => {
  const key = activeConversation.value?.key;
  return key ? bridleStore.epochFor(key) : 0;
});

// ── Queue (CLEAN-245) ─────────────────────────────────────────
// The composer is never locked on the agent's account. A message the agent
// cannot take now waits above the composer, and this chat sends the first of
// them each time the agent becomes free: one per turn, in order.

const queue = computed(() => {
  const key = activeConversation.value?.key;
  return key ? bridleStore.queueFor(key) : [];
});
const queueState = computed(() => {
  const conversation = activeConversation.value;
  return conversation
    ? bridleStore.queueStateFor(conversation, props.agentState)
    : null;
});
const takes = computed(() =>
  queueState.value ? canTake(queueState.value) : false,
);
// "Older than a day" is a reading of the clock: taken when the queue or the
// agent changes, and once a minute while something waits.
const nowMs = ref(Date.now());
let nowTimer: ReturnType<typeof setInterval> | undefined;
watch(
  () => queue.value.length > 0,
  (waiting) => {
    nowMs.value = Date.now();
    if (waiting && !nowTimer) {
      nowTimer = setInterval(() => (nowMs.value = Date.now()), 60_000);
    } else if (!waiting && nowTimer) {
      clearInterval(nowTimer);
      nowTimer = undefined;
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  if (nowTimer) clearInterval(nowTimer);
});
const heldReason = computed(() =>
  queueState.value ? held(queue.value, queueState.value, nowMs.value) : null,
);

watch(
  () => [takes.value, heldReason.value, queue.value.length] as const,
  ([free, reason, waiting]) => {
    const conversation = activeConversation.value;
    if (!conversation || !free || reason || !waiting) return;
    void bridleStore.drain(conversation, props.agentState);
  },
  { immediate: true },
);

// The panel sits between the transcript and the composer: a row more takes
// its height from the transcript. A reader at the bottom stays there.
watch([() => queue.value.length, heldReason], async () => {
  const follow = isNearBottom();
  await nextTick();
  if (follow) scrollToBottom();
});

const inputRef = ref<{ requestEdit: (id: string) => void } | null>(null);

function onSubmit(text: string) {
  const conversation = activeConversation.value;
  if (!conversation) return 'ignored' as const;
  const result = bridleStore.submit(conversation, text, props.agentState);
  // Wherever the person was reading, they just spoke: show them their
  // message. The watcher below would not — it only follows a reader who was
  // already at the bottom.
  if (result === 'sent') void nextTick(scrollToBottom);
  return result;
}

function onResend(id: string) {
  const conversation = activeConversation.value;
  if (conversation) bridleStore.resend(conversation, id);
}

function onDiscard(id: string) {
  const conversation = activeConversation.value;
  if (conversation) bridleStore.discard(conversation, id);
}

watch(
  () => [
    messages.value.length,
    sending.value,
    // Every new step and every streamed chunk grows the flow.
    thinkingBlocks.value.reduce((n, b) => n + b.steps.length, 0),
    messages.value[messages.value.length - 1]?.text.length ?? 0,
    // A delivery line appearing under the last message grows it too.
    messages.value[messages.value.length - 1]?.delivery,
  ],
  async () => {
    // Measured BEFORE the DOM grows (a watcher runs ahead of the render):
    // afterwards the new content itself would push a reader who was at the
    // bottom out of range. Someone scrolled up to read is left where they are.
    const follow = isNearBottom();
    await nextTick();
    if (follow) scrollToBottom();
  },
);

onMounted(async () => {
  await nextTick();
  const el = scrollEl.value;
  if (el) el.scrollTop = el.scrollHeight;
});

const agentInitial = computed(() => {
  const source = props.title?.trim() || props.agentId || 'Agent';
  return source.split(/\s+/).filter(Boolean)[0]?.[0]?.toUpperCase() ?? 'A';
});

// ── Drag and drop ──────────────────────────────────────────────
// The drop target is the whole conversation, not the input, so the drag state
// lives here and the compose area is swapped out while a file is overhead.

const isDraggingFile = ref(false);
/**
 * `dragleave` fires every time the pointer crosses into a child element, so a
 * naive boolean flickers as you move over bubbles and avatars. Counting enters
 * against leaves and treating zero as "gone" is the standard fix.
 */
const dragDepth = ref(0);

/** Only file drags matter — dragging selected text must not arm the zone. */
function dragHasFiles(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  return types ? Array.from(types).includes('Files') : false;
}

function onDragEnter(event: DragEvent) {
  if (!dragHasFiles(event)) return;
  event.preventDefault();
  dragDepth.value++;
  isDraggingFile.value = true;
}

function onDragOver(event: DragEvent) {
  if (!dragHasFiles(event)) return;
  // Without this the browser treats the drop as a navigation.
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
}

function onDragLeave(event: DragEvent) {
  if (!dragHasFiles(event)) return;
  event.preventDefault();
  dragDepth.value = Math.max(0, dragDepth.value - 1);
  if (dragDepth.value === 0) isDraggingFile.value = false;
}

function onDrop(event: DragEvent) {
  if (!dragHasFiles(event)) return;
  event.preventDefault();
  // Reset unconditionally: a drop ends the drag however the counter got here.
  dragDepth.value = 0;
  isDraggingFile.value = false;
  const conversation = activeConversation.value;
  if (!conversation) return;

  const files = event.dataTransfer?.files;
  if (files?.length) bridleStore.stageFiles(conversation, files);
}

/**
 * A file released anywhere else on the page would otherwise make the browser
 * navigate to it, throwing away the conversation. Swallow the default while
 * this chat is mounted.
 */
function preventWindowDrop(event: DragEvent) {
  event.preventDefault();
}

onMounted(() => {
  window.addEventListener('dragover', preventWindowDrop);
  window.addEventListener('drop', preventWindowDrop);
});

onBeforeUnmount(() => {
  window.removeEventListener('dragover', preventWindowDrop);
  window.removeEventListener('drop', preventWindowDrop);
  // Object URLs for anything still staged would otherwise leak.
  const conversation = activeConversation.value;
  if (conversation) bridleStore.clearStaged(conversation);
});
</script>

<template>
  <div
    class="flex h-full flex-col"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <BridleChatEmpty v-if="!activeConversation" />

    <template v-else>
      <header
        v-if="showHeader"
        class="shrink-0 border-b px-4 py-3"
      >
        <h2 class="font-semibold">{{ title ?? agentId }}</h2>
        <p v-if="subtitle" class="text-xs text-muted-foreground">
          {{ subtitle }}
        </p>
      </header>

      <!-- Message list — gradient backdrop so bubbles read against it. The
           wrapper is what a host covers while the agent restarts (`overlay`):
           the transcript, never the composer below it (CLEAN-245). -->
      <div class="relative flex min-h-0 flex-1 flex-col">
      <div
        ref="scrollEl"
        class="flex-1 min-h-0 overflow-y-auto bg-linear-to-b from-muted/20 via-background to-background"
        :class="{ 'flex': !messages.length }"
        @scroll.passive="onScroll"
      >
        <div class="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-6"
        :class="{ 'justify-center': !messages.length }"
        >
          <!-- Earlier pages of the conversation. A button as well as a hint:
               a short page on a tall screen has nothing to scroll, and a
               keyboard has no scroll at all. -->
          <p
            v-if="loadingOlder"
            class="flex items-center justify-center gap-2 py-1 text-xs text-muted-foreground"
            role="status"
          >
            <Icon name="loader-2" :size="12" class="animate-spin" />
            {{ $t('chat.older_loading') }}
          </p>
          <button
            v-else-if="hasOlder"
            type="button"
            class="mx-auto rounded-full px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
            @click="loadOlder"
          >
            {{ $t('chat.older_hint') }}
          </button>

          <!-- Conversation starter when no messages yet -->
          <div
            v-if="!messages.length"
            class="mt-8 flex flex-col items-center text-center"
          >
            <div
              class="flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/25 bg-linear-to-br from-primary/25 to-primary/5 text-lg font-semibold text-primary shadow-[0_0_0_8px_rgba(245,161,107,0.06)]"
            >
              {{ agentInitial }}
            </div>
            <h3 class="mt-3 text-sm font-semibold">
              {{ title ?? $t('chat.agent') }}
            </h3>
            <p class="mt-1 max-w-xs text-xs text-muted-foreground">
              {{ $t('chat.starter_hint') }}
            </p>
          </div>

          <template v-for="item in chatFlow" :key="item.key">
            <BridleChatMessage
              v-if="item.kind === 'message'"
              :message="item.message"
              :conversation="activeConversation"
              :agent-name="title"
              :send-paused-by="sendPausedBy"
              @resend="onResend"
              @discard="onDiscard"
            />
            <!-- The times under the bubbles are times of day; this says of
                 which day. Today / yesterday are keys, older days arrive
                 already formatted for the locale. -->
            <div
              v-else-if="item.kind === 'day'"
              class="flex justify-center py-1"
              role="separator"
            >
              <span
                class="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground"
                :title="dayTitle(item.ts)"
              >
                {{ item.labelKey ? $t(item.labelKey) : item.label }}
              </span>
            </div>
            <!-- A thinking segment sits where the agent's work happened:
                 above the answer it led to, below the message it answers. -->
            <div v-else class="flex items-start gap-2">
              <div
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-primary/25 to-primary/5 text-[11px] font-semibold text-primary"
                :title="title"
              >
                {{ agentInitial }}
              </div>
              <BridleChatThinking
                :block="item.block"
                :agent-name="agentLabel ?? $t('chat.agent')"
              />
            </div>
          </template>

          <!-- Shimmer status while the agent works and has published no
               steps yet (or none at all): replaces the old bouncing dots and
               stays through silent tool phases until the first words land. -->
          <div
            v-if="sending && !hasOpenThinking"
            class="flex items-center gap-2"
            role="status"
            :aria-label="$t('chat.thinking', { name: agentLabel ?? $t('chat.agent') })"
          >
            <div
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-primary/25 to-primary/5 text-[11px] font-semibold text-primary"
            >
              {{ agentInitial }}
            </div>
            <span class="shimmer shimmer-duration-1600 px-1 text-sm font-medium text-muted-foreground">
              {{ $t('chat.thinking', { name: agentLabel ?? $t('chat.agent') }) }}
            </span>
          </div>

          <p
            v-if="reconnecting"
            class="flex items-center gap-2 px-1 text-xs text-muted-foreground"
            role="status"
          >
            <Icon name="loader-2" :size="12" class="animate-spin" />
            {{ $t('chat.reconnecting') }}
          </p>

          <div
            v-if="error"
            class="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
          >
            <Icon name="alert-triangle" :size="14" class="mt-px shrink-0" />
            <span class="flex-1">{{ $t(error.key, noticeParams(error, format.size)) }}</span>
            <button
              type="button"
              class="shrink-0 rounded p-0.5 hover:bg-destructive/10"
              :aria-label="$t('chat.dismiss')"
              @click="dismissError"
            >
              <Icon name="x" :size="12" />
            </button>
          </div>
        </div>
      </div>
      <slot name="overlay" />
      </div>

      <!-- The compose area is replaced, not covered: the dashed block takes
           its place while a file is overhead. Draft text and staged files live
           in the store, so the swap cannot lose them. Neither is disabled
           on the agent's account: what it cannot take now waits in the queue
           (CLEAN-245), and the store gates sending on uploads alone. -->
      <div
        v-if="toolView || ownToolNotice"
        class="shrink-0 px-4 pt-2"
      >
        <p
          class="mx-auto flex max-w-3xl items-start gap-2 rounded-md border px-3 py-2 text-xs"
          :class="
            toolView
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300'
              : 'border-border bg-muted/50 text-muted-foreground'
          "
          role="status"
          :data-tool-state="toolView?.kind ?? ownToolNotice?.kind"
        >
          <Icon
            v-if="(toolView?.kind ?? ownToolNotice?.kind) === 'connecting'"
            name="loader-2"
            :size="12"
            class="mt-0.5 shrink-0 animate-spin"
          />
          <span v-if="toolView">
            <span class="font-medium">{{ $t(toolView.labelKey) }}</span>
            <template v-for="line in toolView.lines" :key="line.key">
              {{ ' ' }}{{
                $t(line.key, {
                  ...line.params,
                  wait: line.wait ? $t(line.wait.key, { count: line.wait.count }) : '',
                })
              }}
            </template>
          </span>
          <span v-else-if="ownToolNotice">{{ $t(ownToolNotice.key) }}</span>
        </p>
      </div>
      <!-- What waits for the agent, directly above the composer and as wide. -->
      <div v-if="queue.length" class="shrink-0 px-4 pt-2">
        <BridleChatQueue
          class="mx-auto max-w-3xl"
          :conversation="activeConversation"
          :held="heldReason"
          @edit="inputRef?.requestEdit($event)"
        />
      </div>
      <BridleChatDropZone v-if="isDraggingFile" />
      <!-- Keyed on the conversation's epoch: after "New chat" the composer
           remounts, so text typed into the closed conversation does not
           follow the person into the new one (CLEAN-136). -->
      <BridleChatInput
        v-else
        :key="composerEpoch"
        :conversation="activeConversation"
        :limit="limit"
        ref="inputRef"
        :limit-notice-id="limitNoticeId"
        :submit="onSubmit"
      />
    </template>
  </div>
</template>
