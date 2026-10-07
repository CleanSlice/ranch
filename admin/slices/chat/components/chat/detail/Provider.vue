<script setup lang="ts">
import { patchSourceRating } from '#bridle/stores/bridle';
import { openCitedSource, setCitedSourceRating } from '#bridle/utils/citedSource';
import { describeCitedSourceError } from '#bridle/utils/citedSourceFile';
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

// ── Cited sources (CLEAN-138) ──────────────────────────────────
// The history shows the same list the live chat does, and opening or rating
// a source goes through the same HTTP module (`#bridle/utils/citedSource`),
// addressed by the session's agent. The rating is optimistic on the page's
// own message list and rolled back when the server says no; a failure is one
// plain line above the feed.
const config = useRuntimeConfig();
const apiUrl =
  (config.public as { apiUrl?: string }).apiUrl ??
  (typeof process !== 'undefined' ? process.env.API_URL : undefined) ??
  'http://localhost:3333';
const sourceError = ref<string | null>(null);

async function onOpenSource(messageId: string, n: number) {
  const agentId = session.value?.agentId;
  if (!agentId) return;
  sourceError.value = null;
  try {
    await openCitedSource(apiUrl, agentId, messageId, n);
  } catch (err) {
    console.warn('[chat] open source failed', { messageId, n }, err);
    sourceError.value = `Could not open source ${n} — ${describeCitedSourceError(err)}`;
  }
}

async function onRateSource(messageId: string, n: number, rating: 1 | -1 | null) {
  const agentId = session.value?.agentId;
  if (!agentId) return;
  const previous = patchSourceRating(messages.value, messageId, n, rating);
  if (previous === undefined) return;
  sourceError.value = null;
  try {
    await setCitedSourceRating(apiUrl, agentId, messageId, n, rating);
  } catch (err) {
    console.warn('[chat] rate source failed', { messageId, n, rating }, err);
    patchSourceRating(messages.value, messageId, n, previous);
    sourceError.value = `Could not save the rating of source ${n} — ${describeCitedSourceError(err)}`;
  }
}
</script>

<template>
  <div class="flex w-full flex-col gap-4">
    <!-- Slim header -->
    <div class="flex items-center gap-3 border-b pb-3">
      <PageBreadcrumbs :items="[{ label: 'Chats', to: '/chats' }, { label: who }]" class="min-w-0" />
      <div class="flex min-w-0 flex-1 items-baseline gap-2">
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
        class="flex h-[calc(100vh-9.75rem)] min-h-0 flex-col gap-4 overflow-y-auto pr-1"
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

        <!-- Opening or rating a cited source failed (CLEAN-138): said once, plainly. -->
        <p
          v-if="sourceError"
          class="text-center text-xs text-muted-foreground"
          role="status"
        >
          {{ sourceError }}
        </p>

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
              @open-source="onOpenSource"
              @rate-source="onRateSource"
            />
          </div>
        </template>
      </div>

      <!-- Right rail -->
      <div
        class="flex flex-col gap-3.5 lg:max-h-[calc(100vh-9.75rem)] lg:overflow-y-auto"
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
