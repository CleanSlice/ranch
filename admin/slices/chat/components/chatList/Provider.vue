<script setup lang="ts">
import { Input } from '#theme/components/ui/input';
import { Button } from '#theme/components/ui/button';
import { Badge } from '#theme/components/ui/badge';
import { Checkbox } from '#theme/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#theme/components/ui/table';
import type { ChatChannel, IChatSession } from '#chat/stores/chat';

// When `agentId` is set, the list is scoped to that agent (used inside the
// agent-detail "Chats" tab) and the agent column is hidden.
const props = defineProps<{ agentId?: string }>();

const store = useChatStore();

const CHANNELS: (ChatChannel | 'all')[] = ['all', 'bridle', 'telegram', 'slack'];
const search = ref('');
const channel = ref<ChatChannel | 'all'>('all');
const archived = ref(false);
const includeInternal = ref(false);
const page = ref(1);
const perPage = 50;

const query = computed(() => ({
  agentId: props.agentId,
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

// Any filter change resets to the first page.
watch([search, channel, archived, includeInternal], () => {
  page.value = 1;
});

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

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
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
            <TableCell class="font-medium">{{ who(s) }}</TableCell>
            <TableCell class="max-w-md truncate text-muted-foreground">
              {{ s.preview || '—' }}
            </TableCell>
            <TableCell class="text-right tabular-nums">{{ s.messageCount }}</TableCell>
            <TableCell class="text-right text-muted-foreground" :title="new Date(s.lastMessageAt).toLocaleString()">
              {{ relTime(s.lastMessageAt) }}
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
