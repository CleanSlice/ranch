<script setup lang="ts">
import {
  BridleChannelStates,
  type IBridleConversation,
} from '#bridle/stores/bridle';
import { buildChatFlow } from '#bridle/utils/chatFlow';

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
  }>(),
  { showHeader: true },
);
const bridleStore = useBridleStore();
// The locale itself, for the date on a day separator (docs/i18n.md keeps
// `useI18n()` for exactly this); every string still goes through `$t`.
const { locale } = useI18n();

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
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'full' }).format(ts);
}

const agentLabel = computed(
  () => props.title?.trim() || props.agentId || 'Agent',
);

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

async function onSend(text: string) {
  const conversation = activeConversation.value;
  if (!conversation) return;
  bridleStore.sendMessage(conversation, text);
  // Wherever the person was reading, they just spoke: show them their
  // message. The watcher below would not — it only follows a reader who was
  // already at the bottom.
  await nextTick();
  scrollToBottom();
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

      <!-- Message list — gradient backdrop so bubbles read against it -->
      <div
        ref="scrollEl"
        class="flex-1 min-h-0 overflow-y-auto bg-linear-to-b from-muted/20 via-background to-background"
        :class="{ 'flex': !messages.length }"
      >
        <div class="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-6"
        :class="{ 'justify-center': !messages.length }"
        >
          <!-- Conversation starter when no messages yet -->
          <div
            v-if="!messages.length"
            class="mt-8 flex flex-col items-center text-center"
          >
            <div
              class="flex h-12 w-12 items-center justify-center rounded-2xl bg-linear-to-br from-primary/20 to-primary/5 text-base font-semibold text-primary"
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
                :agent-name="agentLabel"
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
            :aria-label="$t('chat.thinking', { name: agentLabel })"
          >
            <div
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-primary/25 to-primary/5 text-[11px] font-semibold text-primary"
            >
              {{ agentInitial }}
            </div>
            <span class="shimmer shimmer-duration-1600 px-1 text-sm font-medium text-muted-foreground">
              {{ $t('chat.thinking', { name: agentLabel }) }}
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
            <span class="flex-1">{{ $t(error.key, error.params ?? {}) }}</span>
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

      <!-- The compose area is replaced, not covered: the dashed block takes
           its place while a file is overhead. Draft text and staged files live
           in the store, so the swap cannot lose them. Neither is disabled
           while the agent answers: a follow-up mid-turn is a normal thing to
           send, and the store gates sending on uploads alone. -->
      <BridleChatDropZone v-if="isDraggingFile" />
      <BridleChatInput
        v-else
        :conversation="activeConversation"
        @send="onSend"
      />
    </template>
  </div>
</template>
