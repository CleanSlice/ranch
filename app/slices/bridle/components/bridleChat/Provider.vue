<template>
  <div class="flex flex-col h-full">
    <BridleChatEmpty v-if="!botId" />
    <template v-else>
      <header class="border-b px-4 py-3">
        <h2 class="font-semibold">{{ title ?? botId }}</h2>
        <p v-if="subtitle" class="text-xs text-muted-foreground">
          {{ subtitle }}
        </p>
      </header>

      <div ref="scrollEl" class="flex-1 overflow-y-auto p-4 space-y-3">
        <BridleChatMessage
          v-for="message in messages"
          :key="message.id"
          :message="message"
        />
        <div v-if="sending" class="text-xs text-muted-foreground">
          {{ t('chat.sending') }}
        </div>
        <div v-if="error" class="text-xs text-red-600">
          {{ t('chat.error') }}: {{ error }}
        </div>
      </div>

      <BridleChatInput :disabled="sending" @send="onSend" />
    </template>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  botId: string | null;
  title?: string;
  subtitle?: string;
}>();

const { t } = useI18n();
const bridleStore = useBridleStore();

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

async function onSend(text: string) {
  if (!props.botId) return;
  await bridleStore.sendMessage(props.botId, text);
}

watch(
  [messages, sending],
  async () => {
    await nextTick();
    if (scrollEl.value) {
      scrollEl.value.scrollTop = scrollEl.value.scrollHeight;
    }
  },
  { deep: true },
);
</script>
