<script setup lang="ts">
import {
  IconArchive,
  IconBrandSlack,
  IconBrandTelegram,
  IconChevronRight,
  IconLink,
  IconMessage,
  IconMessageOff,
  IconRefresh,
  IconRobot,
  IconSearch,
  IconShield,
} from '@tabler/icons-vue';
import type { Component } from 'vue';
import type { ChatChannel, IChatSession } from '#chat/stores/chat';
import { chatCountLabel, chatUser, groupByDay, isConversation } from '#chat/utils/chatList';
import { formatClock } from '#common/utils/format';

// When `agentId` is set, the list is scoped to that agent (used inside the
// agent-detail "Chats" tab): the agent filter and the agent name are hidden.
// Without it (global /chats page) both render, with names resolved from the
// agent store.
const props = defineProps<{ agentId?: string }>();

const store = useChatStore();
const agentStore = useAgentStore();

const showAgent = computed(() => !props.agentId);

// Reka UI disallows empty-string <SelectItem value="">, so "all agents" uses
// a sentinel that maps to `undefined` at the query edge.
const AGENT_ALL = '__all__';

const CHANNELS: (ChatChannel | 'all')[] = ['all', 'bridle', 'telegram', 'slack'];
const search = ref('');
const channel = ref<ChatChannel | 'all'>('all');
const agentFilter = ref(AGENT_ALL);
const archived = ref(false);
const includeInternal = ref(false);
const page = ref(1);
const perPage = 50;

// Everything but the channel and the page: the segment counts are taken
// against this, so each segment says how many it would show.
const baseQuery = computed(() => ({
  agentId: props.agentId ?? (agentFilter.value === AGENT_ALL ? undefined : agentFilter.value),
  search: search.value.trim() || undefined,
  archived: archived.value || undefined,
  includeInternal: includeInternal.value || undefined,
}));

const query = computed(() => ({
  ...baseQuery.value,
  channel: channel.value === 'all' ? undefined : channel.value,
  page: page.value,
  perPage,
}));

const { data, pending, refresh } = await useAsyncData(
  `chat-list-${props.agentId ?? 'all'}`,
  () => store.list(query.value),
  { watch: [query] },
);

// One count per segment: a page of one row is the cheapest way to ask the
// server for a total under the same filters.
const { data: counts } = await useAsyncData(
  `chat-list-counts-${props.agentId ?? 'all'}`,
  async () => {
    const totals = await Promise.all(
      CHANNELS.map((c) =>
        store.list({ ...baseQuery.value, channel: c === 'all' ? undefined : c, perPage: 1 }),
      ),
    );
    return Object.fromEntries(CHANNELS.map((c, i) => [c, totals[i].total])) as Record<
      string,
      number
    >;
  },
  { watch: [baseQuery] },
);

// Agents are only needed to render the filter options and the agent name.
await useAsyncData('chat-list-agents', () => agentStore.fetchAll(), {
  immediate: showAgent.value,
});

// Any filter change resets to the first page.
watch([search, channel, agentFilter, archived, includeInternal], () => {
  page.value = 1;
});

function agentName(id: string): string {
  return agentStore.agents.find((a) => a.id === id)?.name ?? id;
}

const total = computed(() => data.value?.total ?? 0);
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / perPage)));
const rows = computed<IChatSession[]>(() => data.value?.items ?? []);
const groups = computed(() => groupByDay(rows.value));

const syncing = ref(false);
const syncNote = ref('');
async function onSync() {
  syncing.value = true;
  syncNote.value = '';
  try {
    const r = await store.sync(props.agentId);
    if (r) syncNote.value = `Indexed ${r.upserted}, skipped ${r.skipped} (${r.scannedFiles} files)`;
    await refresh();
  } catch (err) {
    syncNote.value = `Sync failed: ${(err as Error).message}`;
  } finally {
    syncing.value = false;
  }
}

const channelTile: Record<string, { icon: Component; class: string }> = {
  bridle: { icon: IconMessage, class: 'bg-primary text-primary-foreground' },
  telegram: { icon: IconBrandTelegram, class: 'bg-blue-100 text-blue-700' },
  slack: { icon: IconBrandSlack, class: 'bg-purple-100 text-purple-800' },
  internal: { icon: IconRobot, class: 'bg-muted text-muted-foreground' },
};
function tile(c: string) {
  return channelTile[c] ?? { icon: IconMessage, class: 'bg-muted text-muted-foreground' };
}

const userIcon: Partial<Record<string, Component>> = {
  admin: IconShield,
  share: IconLink,
  internal: IconRobot,
};
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Filters -->
    <div class="flex flex-wrap items-center gap-2.5">
      <label class="relative flex min-w-0 flex-[1_1_240px] items-center md:max-w-sm">
        <span class="sr-only">Search chats</span>
        <IconSearch class="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
        <Input
          v-model="search"
          type="search"
          placeholder="Search agent, user, message…"
          class="h-10 pl-9"
        />
      </label>

      <div role="group" aria-label="Channel" class="flex flex-none gap-0.5 rounded-xl bg-muted p-[3px]">
        <button
          v-for="c in CHANNELS"
          :key="c"
          type="button"
          :aria-pressed="channel === c"
          class="inline-flex h-8 items-center gap-1.5 rounded-[9px] px-3 text-[13px] capitalize transition-colors"
          :class="
            channel === c
              ? 'bg-background font-semibold text-foreground shadow-sm'
              : 'font-medium text-muted-foreground hover:bg-background/60 hover:text-foreground'
          "
          @click="channel = c"
        >
          {{ c }}
          <span v-if="counts" class="text-[11px] font-semibold text-muted-foreground">
            {{ counts[c] ?? 0 }}
          </span>
        </button>
      </div>

      <Select v-if="showAgent" v-model="agentFilter">
        <SelectTrigger class="h-10 w-52" aria-label="Filter by agent">
          <SelectValue placeholder="All agents" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem :value="AGENT_ALL">All agents</SelectItem>
          <SelectItem v-for="a in agentStore.agents" :key="a.id" :value="a.id">
            {{ a.name }}
          </SelectItem>
        </SelectContent>
      </Select>

      <label class="flex min-h-8 cursor-pointer items-center gap-2 text-[13px] text-muted-foreground">
        <Switch v-model="archived" /> Archived
      </label>
      <label class="flex min-h-8 cursor-pointer items-center gap-2 text-[13px] text-muted-foreground">
        <Switch v-model="includeInternal" /> Internal
      </label>

      <div class="ml-auto flex items-center gap-2">
        <span v-if="syncNote" class="text-xs text-muted-foreground">{{ syncNote }}</span>
        <Button variant="outline" :disabled="syncing" @click="onSync">
          <IconRefresh class="size-4" :class="syncing && 'animate-spin'" />
          {{ syncing ? 'Syncing…' : 'Sync' }}
        </Button>
      </div>
    </div>

    <!-- Rows, a group per day -->
    <div v-if="pending" class="text-sm text-muted-foreground">Loading…</div>

    <Card v-else-if="rows.length" class="gap-0 overflow-hidden py-0">
      <template v-for="g in groups" :key="g.key">
        <ChatListDayHeading :at="g.at" :count="g.sessions.length" />
        <NuxtLink
          v-for="s in g.sessions"
          :key="s.id"
          :to="`/chats/${s.id}`"
          class="group flex items-start gap-3.5 border-b px-5 py-3.5 text-foreground transition-colors last:border-b-0 hover:bg-muted/40"
        >
          <span
            :title="s.channel"
            class="flex size-10 flex-none items-center justify-center rounded-xl"
            :class="tile(s.channel).class"
          >
            <component :is="tile(s.channel).icon" class="size-5" />
          </span>

          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <template v-if="showAgent">
                <span class="text-[14.5px] font-semibold leading-tight">{{ agentName(s.agentId) }}</span>
                <span aria-hidden="true" class="text-muted-foreground/60">·</span>
              </template>
              <Badge variant="secondary" class="gap-1 font-medium" :title="chatUser(s).fullId">
                <component :is="userIcon[chatUser(s).kind]" v-if="userIcon[chatUser(s).kind]" />
                {{ chatUser(s).label }}
              </Badge>
              <span
                v-if="chatUser(s).id"
                class="font-mono text-[12.5px] text-muted-foreground"
                :title="chatUser(s).fullId"
              >
                {{ chatUser(s).id }}
              </span>
              <Badge v-if="s.archived" variant="outline" class="gap-1 font-medium text-muted-foreground">
                <IconArchive />
                archived
              </Badge>
            </div>
            <p class="truncate text-[13.5px] text-muted-foreground">{{ s.preview || '—' }}</p>
          </div>

          <div class="flex flex-none items-center gap-3 pt-0.5">
            <span
              class="inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-semibold tabular-nums"
              :class="isConversation(s) ? 'bg-indigo-100 text-indigo-700' : 'bg-muted text-muted-foreground'"
              :title="`${s.messageCount} messages`"
            >
              <IconMessage class="size-3.5" />
              {{ s.messageCount }}
            </span>
            <span class="w-11 text-right text-[12.5px] tabular-nums text-muted-foreground">
              {{ formatClock(s.lastMessageAt) }}
            </span>
            <IconChevronRight
              class="size-4 text-muted-foreground opacity-40 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
            />
          </div>
        </NuxtLink>
      </template>
    </Card>

    <div
      v-else
      class="flex flex-col items-center gap-2.5 rounded-xl border border-dashed px-6 py-14 text-center"
    >
      <span class="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <IconMessageOff class="size-5" />
      </span>
      <span class="text-[15px] font-semibold">No chats here</span>
      <span class="text-[13px] text-muted-foreground">
        Try another channel or agent, or run <span class="font-medium text-foreground">Sync</span> to index existing sessions.
      </span>
    </div>

    <!-- Pagination -->
    <div v-if="pageCount > 1" class="flex items-center justify-end gap-2 text-sm">
      <span class="text-muted-foreground">Page {{ page }} of {{ pageCount }} · {{ total }} total</span>
      <Button size="sm" variant="outline" :disabled="page <= 1" @click="page--">Prev</Button>
      <Button size="sm" variant="outline" :disabled="page >= pageCount" @click="page++">Next</Button>
    </div>
  </div>
</template>
