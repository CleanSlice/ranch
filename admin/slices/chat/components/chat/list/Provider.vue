<script setup lang="ts">
import type { ChatChannel, IChatSession } from '#chat/stores/chat';

// When `agentId` is set, the list is scoped to that agent (used inside the
// agent-detail "Chats" tab): the agent filter and the agent column are hidden.
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

const query = computed(() => ({
  agentId: props.agentId ?? (agentFilter.value === AGENT_ALL ? undefined : agentFilter.value),
  channel: channel.value === 'all' ? undefined : channel.value,
  search: search.value.trim() || undefined,
  archived: archived.value || undefined,
  includeInternal: includeInternal.value || undefined,
  page: page.value,
  perPage,
}));

const { data, pending, refresh } = await useAsyncData(
  `chat-list-${props.agentId ?? 'all'}`,
  () => store.list(query.value),
  { watch: [query] },
);

// Agents are only needed to render the filter options and the Agent column.
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

const channelVariant: Record<string, 'default' | 'secondary' | 'outline'> = {
  bridle: 'default',
  telegram: 'secondary',
  slack: 'secondary',
  internal: 'outline',
};

function who(s: IChatSession): string {
  return s.title || s.externalUserId || '—';
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Filters -->
    <div class="flex flex-wrap items-center gap-2">
      <Input v-model="search" placeholder="Search title, preview, user…" class="max-w-xs" />
      <div class="flex gap-1">
        <Button
          v-for="c in CHANNELS"
          :key="c"
          size="sm"
          :variant="channel === c ? 'default' : 'outline'"
          class="capitalize"
          @click="channel = c"
        >
          {{ c }}
        </Button>
      </div>
      <Select v-if="showAgent" v-model="agentFilter">
        <SelectTrigger class="h-8 w-48" aria-label="Filter by agent">
          <SelectValue placeholder="All agents" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem :value="AGENT_ALL">All agents</SelectItem>
          <SelectItem v-for="a in agentStore.agents" :key="a.id" :value="a.id">
            {{ a.name }}
          </SelectItem>
        </SelectContent>
      </Select>
      <label class="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Checkbox v-model="archived" /> Archived
      </label>
      <label class="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Checkbox v-model="includeInternal" /> Internal
      </label>
      <div class="ml-auto flex items-center gap-2">
        <span v-if="syncNote" class="text-xs text-muted-foreground">{{ syncNote }}</span>
        <Button size="sm" variant="outline" :disabled="syncing" @click="onSync">
          {{ syncing ? 'Syncing…' : 'Sync' }}
        </Button>
      </div>
    </div>

    <!-- Table -->
    <div v-if="pending" class="text-sm text-muted-foreground">Loading…</div>
    <div v-else-if="rows.length" class="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Channel</TableHead>
            <TableHead v-if="showAgent">Agent</TableHead>
            <TableHead>User</TableHead>
            <TableHead>Last message</TableHead>
            <TableHead class="text-right">Msgs</TableHead>
            <TableHead class="text-right">Last activity</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="s in rows"
            :key="s.id"
            class="cursor-pointer"
            @click="navigateTo(`/chats/${s.id}`)"
          >
            <TableCell>
              <Badge :variant="channelVariant[s.channel] ?? 'outline'" class="capitalize">
                {{ s.channel }}
              </Badge>
              <Badge v-if="s.archived" variant="outline" class="ml-1">archived</Badge>
            </TableCell>
            <TableCell v-if="showAgent" @click.stop>
              <NuxtLink
                :to="`/agents/${s.agentId}`"
                class="text-sm font-medium hover:underline"
              >
                {{ agentName(s.agentId) }}
              </NuxtLink>
            </TableCell>
            <TableCell class="font-medium">{{ who(s) }}</TableCell>
            <TableCell class="max-w-md truncate text-muted-foreground">
              {{ s.preview || '—' }}
            </TableCell>
            <TableCell class="text-right tabular-nums">{{ s.messageCount }}</TableCell>
            <TableCell class="text-right text-muted-foreground">
              <DateTimeAgo :date="s.lastMessageAt" />
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
    <div v-else class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
      No chats yet. Run <span class="font-medium">Sync</span> to index existing sessions.
    </div>

    <!-- Pagination -->
    <div v-if="pageCount > 1" class="flex items-center justify-end gap-2 text-sm">
      <span class="text-muted-foreground">Page {{ page }} of {{ pageCount }} · {{ total }} total</span>
      <Button size="sm" variant="outline" :disabled="page <= 1" @click="page--">Prev</Button>
      <Button size="sm" variant="outline" :disabled="page >= pageCount" @click="page++">Next</Button>
    </div>
  </div>
</template>
