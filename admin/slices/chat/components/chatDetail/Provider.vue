<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import { Badge } from '#theme/components/ui/badge';
import { Checkbox } from '#theme/components/ui/checkbox';
import { IconArrowLeft } from '@tabler/icons-vue';
import type { IChatMessage } from '#chat/stores/chat';

const props = defineProps<{ id: string }>();
const store = useChatStore();

const { data: session } = await useAsyncData(`chat-detail-${props.id}`, () =>
  store.getById(props.id),
);

const PAGE = 50;
const messages = ref<IChatMessage[]>([]);
const cursor = ref<string | null>(null);
const hasMore = ref(false);
const loading = ref(false);
const showTools = ref(false);
const scroller = ref<HTMLElement | null>(null);

const types = computed(() =>
  showTools.value
    ? 'user,assistant,summary,tool_call,tool_result,system'
    : 'user,assistant,summary',
);

async function loadLatest() {
  loading.value = true;
  try {
    const r = await store.messages(props.id, { limit: PAGE, types: types.value });
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
    const r = await store.messages(props.id, {
      limit: PAGE,
      cursor: cursor.value,
      types: types.value,
    });
    messages.value = [...r.messages, ...messages.value];
    cursor.value = r.nextCursor;
    hasMore.value = r.hasMore;
    // Keep the viewport anchored where the user was after prepending older msgs.
    await nextTick();
    if (scroller.value) {
      scroller.value.scrollTop = scroller.value.scrollHeight - prevHeight;
    }
  } finally {
    loading.value = false;
  }
}

onMounted(loadLatest);
watch(showTools, loadLatest); // re-fetch from latest when toggling tool events

const who = computed(
  () => session.value?.title || session.value?.externalUserId || '—',
);
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
      <IconArrowLeft class="size-4" /> Chats
    </NuxtLink>

    <!-- Meta header -->
    <div v-if="session" class="rounded-md border bg-card p-4">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-lg font-semibold">{{ who }}</span>
        <Badge variant="secondary" class="capitalize">{{ session.channel }}</Badge>
        <Badge v-if="session.archived" variant="outline">archived</Badge>
      </div>
      <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{{ session.messageCount }} messages · {{ session.userMessageCount }} from user</span>
        <span>Last activity {{ fmt(session.lastMessageAt) }}</span>
        <span class="font-mono">{{ session.sessionKey }}</span>
      </div>
      <p
        v-if="session.summary"
        class="mt-3 rounded bg-muted/40 p-3 text-sm text-muted-foreground"
      >
        {{ session.summary }}
      </p>
    </div>

    <!-- Controls -->
    <div class="flex items-center justify-between">
      <label class="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Checkbox v-model="showTools" /> Show tool events
      </label>
      <Button size="sm" variant="ghost" :disabled="loading" @click="loadLatest">
        Refresh
      </Button>
    </div>

    <!-- Transcript -->
    <div
      ref="scroller"
      class="flex max-h-[65vh] flex-col gap-3 overflow-y-auto rounded-md border bg-card p-4"
    >
      <div v-if="hasMore" class="flex justify-center">
        <Button size="sm" variant="outline" :disabled="loading" @click="loadOlder">
          {{ loading ? 'Loading…' : 'Load older' }}
        </Button>
      </div>

      <div v-if="!messages.length && !loading" class="py-10 text-center text-sm text-muted-foreground">
        No messages in this session.
      </div>

      <ChatMessageBubble v-for="m in messages" :key="m.id" :message="m" />
    </div>
  </div>
</template>
