<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    agentId: string | null;
    title?: string;
    subtitle?: string;
    /** Hide the inner header — useful when the parent already shows agent identity. */
    showHeader?: boolean;
  }>(),
  { showHeader: true },
);
const bridleStore = useBridleStore();

// Replay persisted conversation so the chat isn't blank after a refresh.
// Watcher (not just onMounted) covers the case where the parent swaps agentId
// without remounting this component.
watch(
  () => props.agentId,
  (agentId) => {
    if (agentId) bridleStore.hydrate(agentId);
  },
  { immediate: true },
);

const messages = computed(() =>
  props.agentId ? bridleStore.messagesFor(props.agentId) : [],
);
const sending = computed(() =>
  props.agentId ? bridleStore.isPending(props.agentId) : false,
);
const error = computed(() =>
  props.agentId ? bridleStore.errorFor(props.agentId) : null,
);

const scrollEl = ref<HTMLElement | null>(null);

function scrollToBottom() {
  const el = scrollEl.value;
  if (!el) return;
  requestAnimationFrame(() => {
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  });
}

async function onSend(text: string) {
  if (!props.agentId) return;
  await bridleStore.sendMessage(props.agentId, text);
}

watch(
  () => [messages.value.length, sending.value],
  async () => {
    await nextTick();
    scrollToBottom();
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
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = sending.value ? 'none' : 'copy';
  }
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
  if (sending.value || !props.agentId) return;

  const files = event.dataTransfer?.files;
  if (files?.length) bridleStore.stageFiles(props.agentId, files);
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
  if (props.agentId) bridleStore.clearStaged(props.agentId);
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
    <BridleChatEmpty v-if="!agentId" />

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

          <BridleChatMessage
            v-for="message in messages"
            :key="message.id"
            :message="message"
            :agent-name="title"
          />

          <!-- Typing indicator: three bouncing dots styled like an agent bubble -->
          <div
            v-if="sending"
            class="flex items-center gap-2 justify-start"
          >
            <div
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-primary/25 to-primary/5 text-[11px] font-semibold text-primary"
            >
              {{ agentInitial }}
            </div>
            <div
              class="rounded-2xl rounded-tl-md bg-muted px-4 py-2.5 shadow-sm"
            >
              <div class="flex h-4 items-center gap-1">
                <span class="bridle-typing-dot h-1.5 w-1.5 rounded-full bg-foreground/50 [animation-delay:0ms]" />
                <span class="bridle-typing-dot h-1.5 w-1.5 rounded-full bg-foreground/50 [animation-delay:150ms]" />
                <span class="bridle-typing-dot h-1.5 w-1.5 rounded-full bg-foreground/50 [animation-delay:300ms]" />
              </div>
            </div>
          </div>

          <div
            v-if="error"
            class="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
          >
            <Icon name="alert-triangle" :size="14" class="mt-px shrink-0" />
            <span>{{ $t('chat.error') }}: {{ error }}</span>
          </div>
        </div>
      </div>

      <!-- The compose area is replaced, not covered: the dashed block takes
           its place while a file is overhead. Draft text and staged files live
           in the store, so the swap cannot lose them. -->
      <BridleChatDropZone
        v-if="isDraggingFile"
        :disabled="sending"
      />
      <BridleChatInput
        v-else
        :agent-id="agentId"
        :disabled="sending"
        @send="onSend"
      />
    </template>
  </div>
</template>

<style scoped>
.bridle-typing-dot {
  display: inline-block;
  animation: bridle-typing 1.2s ease-in-out infinite;
  transform-origin: center;
}

@keyframes bridle-typing {
  0%,
  80%,
  100% {
    transform: translateY(0);
    opacity: 0.35;
  }
  40% {
    transform: translateY(-3px);
    opacity: 1;
  }
}
</style>
