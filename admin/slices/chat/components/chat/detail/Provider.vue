<script setup lang="ts">
import { IconArrowLeft } from '@tabler/icons-vue';
import {
  groupTranscript,
  snippet,
  type INavMapItem,
} from '#chat/utils/transcript';

const props = defineProps<{ id: string }>();
const store = useChatStore();

const { data: session } = await useAsyncData(`chat-detail-${props.id}`, () =>
  store.getById(props.id),
);

const { messages, hasMore, loading, showTools, scroller, loadLatest, loadOlder } =
  useChatTranscript(props.id);
const { feedbackByMsg, rate } = useChatFeedback(props.id);

const who = computed(
  () => session.value?.title || session.value?.externalUserId || '—',
);

const grouped = computed(() => groupTranscript(messages.value));

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

function onExport(format: 'json' | 'markdown' | 'csv') {
  void store.exportChat(props.id, format);
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-6xl flex-col gap-4">
    <!-- Slim header -->
    <div class="flex items-center gap-3 border-b pb-3">
      <NuxtLink
        to="/chats"
        class="inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <IconArrowLeft class="size-4" /> Chats
      </NuxtLink>
      <div class="h-[18px] w-px bg-border" />
      <div class="flex min-w-0 flex-1 items-baseline gap-2">
        <span class="truncate text-[15px] font-semibold tracking-tight">{{ who }}</span>
        <Badge v-if="session" variant="secondary" class="capitalize">
          {{ session.channel }}
        </Badge>
        <Badge v-if="session?.archived" variant="outline">archived</Badge>
      </div>
      <Button size="sm" variant="outline" :disabled="loading" @click="loadLatest">
        Refresh
      </Button>
    </div>

    <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <!-- Feed -->
      <div
        ref="scroller"
        class="flex h-[calc(100vh-10.5rem)] min-h-0 flex-col gap-4 overflow-y-auto pr-1"
      >
        <div v-if="hasMore" class="flex justify-center">
          <Button size="sm" variant="outline" :disabled="loading" @click="loadOlder">
            {{ loading ? 'Loading…' : 'Load older' }}
          </Button>
        </div>

        <div
          v-if="!messages.length && !loading"
          class="py-16 text-center text-sm text-muted-foreground"
        >
          No messages in this session.
        </div>

        <template v-for="item in grouped" :key="item.key">
          <!-- Standalone tool events (no assistant reply after them) -->
          <div v-if="item.message === null" class="pl-9">
            <ChatMessageToolEvents :tools="item.tools" class="max-w-[82%]" />
          </div>
          <div v-else :data-msg-id="item.message.id" class="scroll-mt-2">
            <ChatMessageBubble
              :message="item.message"
              :tools="item.tools"
              :rating="feedbackByMsg[item.message.id] ?? null"
              @rate="(r: 1 | -1) => rate(item.message!.id, r)"
            />
          </div>
        </template>
      </div>

      <!-- Right rail -->
      <div
        class="flex flex-col gap-3.5 lg:max-h-[calc(100vh-10.5rem)] lg:overflow-y-auto"
      >
        <ChatDetailMetaCard
          v-if="session"
          :session="session"
          v-model:show-tools="showTools"
        />
        <ChatDetailSummaryCard
          v-if="session"
          :session="session"
          @updated="session = $event"
        />
        <ChatDetailNavMap :items="navItems" @jump="onJump" />
        <div class="flex items-center gap-1.5 px-1">
          <span class="mr-1 text-xs text-muted-foreground">Export</span>
          <Button size="sm" variant="outline" @click="onExport('json')">JSON</Button>
          <Button size="sm" variant="outline" @click="onExport('markdown')">MD</Button>
          <Button size="sm" variant="outline" @click="onExport('csv')">CSV</Button>
        </div>
      </div>
    </div>
  </div>
</template>
