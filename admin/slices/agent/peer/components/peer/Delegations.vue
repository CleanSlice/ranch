<script setup lang="ts">
import { IconRefresh } from '@tabler/icons-vue';
import { usePeerStore } from '#peer/stores/peer';

/**
 * Recent delegations (CLEAN-74, FR-016): who this agent asked, why, how long
 * it took and how it ended — readable without opening a chat.
 *
 * The value is in the failures. "Answered in 3.1 s" is reassuring; three
 * "peer not running" rows in a row are the reason someone opens this panel.
 */
const props = defineProps<{ agentId: string }>();

const store = usePeerStore();

const refreshing = ref(false);

const rows = computed(() => store.delegations(props.agentId));

/** Codes, rendered as the sentence an operator would say. */
const CAUSES: Record<string, string> = {
  PEER_NOT_RUNNING: 'peer not running',
  PEER_TIMEOUT: 'timed out',
  PEER_REJECTED_LOOP: 'refused: would loop',
  PEER_REJECTED_DEPTH: 'refused: chain too deep',
  PEER_UNAUTHORIZED: 'credential refused',
  PEER_UNREACHABLE: 'could not be reached',
  PEER_ERROR: 'error',
};

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  answered: 'default',
  waiting: 'secondary',
  failed: 'destructive',
  rejected: 'destructive',
};

function outcome(row: { status: string; errorCode: string | null }): string {
  if (row.status === 'answered') return 'answered';
  if (row.status === 'waiting') return 'waiting';
  return row.errorCode ? (CAUSES[row.errorCode] ?? row.errorCode) : row.status;
}

function duration(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

async function refresh() {
  refreshing.value = true;
  try {
    await store.loadDelegations(props.agentId);
  } finally {
    refreshing.value = false;
  }
}
</script>

<template>
  <Card>
    <CardHeader class="flex-row items-start justify-between gap-4 space-y-0">
      <div class="space-y-1.5">
        <CardTitle>Recent delegations</CardTitle>
        <CardDescription>
          Tasks this agent handed to a peer, newest first.
        </CardDescription>
      </div>
      <Button variant="ghost" size="sm" :disabled="refreshing" @click="refresh">
        <IconRefresh class="mr-1.5 size-4" />
        Refresh
      </Button>
    </CardHeader>

    <CardContent>
      <Table v-if="rows.length">
        <TableHeader>
          <TableRow>
            <TableHead>Peer</TableHead>
            <TableHead>Task</TableHead>
            <TableHead>Outcome</TableHead>
            <TableHead>Started</TableHead>
            <TableHead class="text-right">Took</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="row in rows" :key="row.id">
            <TableCell>
              <NuxtLink
                :to="`/agents/${row.peerAgentId}`"
                class="hover:underline"
              >
                {{ row.peerName }}
              </NuxtLink>
            </TableCell>
            <TableCell class="max-w-xs">
              <span class="line-clamp-2 text-muted-foreground" :title="row.task">
                {{ row.task }}
              </span>
            </TableCell>
            <TableCell>
              <Badge :variant="STATUS_VARIANT[row.status] ?? 'outline'">
                {{ outcome(row) }}
              </Badge>
            </TableCell>
            <TableCell>
              <DateTimeAgo :date="row.startedAt" class="!items-start" />
            </TableCell>
            <TableCell class="text-right tabular-nums">
              {{ duration(row.durationMs) }}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>

      <div
        v-else
        class="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
      >
        No delegations yet.
      </div>
    </CardContent>
  </Card>
</template>
