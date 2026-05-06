<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    botId: string | null;
    title?: string;
    subtitle?: string;
    /** Hide the inner header — useful when the parent already shows agent identity. */
    showHeader?: boolean;
  }>(),
  { showHeader: true },
);

const { t } = useI18n();
const bridleStore = useBridleStore();

// Replay persisted conversation so the chat isn't blank after a refresh.
// Watcher (not just onMounted) covers the case where the parent swaps botId
// without remounting this component.
watch(
  () => props.botId,
  (botId) => {
    if (botId) bridleStore.hydrate(botId);
  },
  { immediate: true },
);

const messages = computed(() =>
  props.botId ? bridleStore.messagesFor(props.botId) : [],
);
const sending = computed(() =>
  props.botId ? bridleStore.isPending(props.botId) : false,
);
const error = computed(() =>
  props.botId ? bridleStore.errorFor(props.botId) : null,
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
  if (!props.botId) return;
  await bridleStore.sendMessage(props.botId, text);
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
  const source = props.title?.trim() || props.botId || 'Agent';
  return source.split(/\s+/).filter(Boolean)[0]?.[0]?.toUpperCase() ?? 'A';
});
</script>

<template>
  <div class="flex h-full flex-col">
    <BridleChatEmpty v-if="!botId" />

    <template v-else>
      <header
        v-if="showHeader"
        class="shrink-0 border-b px-4 py-3"
      >
        <h2 class="font-semibold">{{ title ?? botId }}</h2>
        <p v-if="subtitle" class="text-xs text-muted-foreground">
          {{ subtitle }}
        </p>
      </header>

      <!-- Message list — gradient backdrop so bubbles read against it -->
      <div
        ref="scrollEl"
        class="flex-1 min-h-0 overflow-y-auto bg-linear-to-b from-muted/20 via-background to-background"
      >
        <div class="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-6">
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
              {{ title ?? t('chat.agent') }}
            </h3>
            <p class="mt-1 max-w-xs text-xs text-muted-foreground">
              Say hello — your message will go straight to the agent runtime.
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
            <span>{{ t('chat.error') }}: {{ error }}</span>
          </div>
        </div>
      </div>

      <BridleChatInput :disabled="sending" @send="onSend" />
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
