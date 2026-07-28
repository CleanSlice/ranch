<script setup lang="ts">
import { IconArrowLeft } from '@tabler/icons-vue';

const props = defineProps<{ id: string }>();
const store = useChatStore();

const { data: session } = await useAsyncData(`chat-detail-${props.id}`, () =>
  store.getById(props.id),
);

const { messages, hasMore, loading, showTools, scroller, loadLatest, loadOlder } =
  useChatTranscript(props.id);
const { feedbackByMsg, rate } = useChatFeedback(props.id);

function onExport(format: 'json' | 'markdown' | 'csv') {
  void store.exportChat(props.id, format);
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

    <ChatDetailSummaryCard
      v-if="session"
      :session="session"
      @updated="session = $event"
    />

    <!-- Controls -->
    <div class="flex items-center justify-between">
      <label class="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Checkbox v-model="showTools" /> Show tool events
      </label>
      <div class="flex items-center gap-1.5">
        <span class="text-xs text-muted-foreground">Export</span>
        <Button size="sm" variant="outline" @click="onExport('json')">JSON</Button>
        <Button size="sm" variant="outline" @click="onExport('markdown')">MD</Button>
        <Button size="sm" variant="outline" @click="onExport('csv')">CSV</Button>
        <Button size="sm" variant="ghost" :disabled="loading" @click="loadLatest">
          Refresh
        </Button>
      </div>
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

      <ChatMessageBubble
        v-for="m in messages"
        :key="m.id"
        :message="m"
        :rating="feedbackByMsg[m.id] ?? null"
        @rate="(r: 1 | -1) => rate(m.id, r)"
      />
    </div>
  </div>
</template>
