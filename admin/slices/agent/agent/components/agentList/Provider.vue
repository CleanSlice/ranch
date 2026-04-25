<script setup lang="ts">
import type { AgentStatusTypes, IAgentData } from '#agent/stores/agent';
import { Button } from '#theme/components/ui/button';
import { Badge } from '#theme/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#theme/components/ui/table';

const agentStore = useAgentStore();

const { data: agents, pending, refresh } = await useAsyncData(
  'admin-agents',
  () => agentStore.fetchAll(),
);

const statusVariant: Record<AgentStatusTypes, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  running: 'default',
  deploying: 'secondary',
  pending: 'secondary',
  stopped: 'outline',
  failed: 'destructive',
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

async function onRestart(agent: IAgentData) {
  await agentStore.restart(agent.id);
  await refresh();
}

const pendingRemoval = ref<IAgentData | null>(null);
const confirmRemoveOpen = computed({
  get: () => pendingRemoval.value !== null,
  set: (v: boolean) => {
    if (!v) pendingRemoval.value = null;
  },
});

async function onRemove() {
  const agent = pendingRemoval.value;
  if (!agent) return;
  pendingRemoval.value = null;
  await agentStore.remove(agent.id);
  await refresh();
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold">Agents</h1>
        <p class="text-sm text-muted-foreground">Manage running agents.</p>
      </div>
      <Button as-child>
        <NuxtLink to="/agents/create">New agent</NuxtLink>
      </Button>
    </div>

    <div v-if="pending" class="text-sm text-muted-foreground">Loading agents…</div>

    <div v-else-if="agents?.length" class="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Resources</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
            <TableHead class="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="agent in agents"
            :key="agent.id"
            class="cursor-pointer"
            @click="navigateTo(`/agents/${agent.id}`)"
          >
            <TableCell class="font-medium">{{ agent.name }}</TableCell>
            <TableCell class="text-muted-foreground">
              {{ agent.resources.cpu }} / {{ agent.resources.memory }}
            </TableCell>
            <TableCell>
              <Badge :variant="statusVariant[agent.status]" class="capitalize">
                {{ agent.status }}
              </Badge>
            </TableCell>
            <TableCell class="text-muted-foreground">{{ formatDate(agent.createdAt) }}</TableCell>
            <TableCell @click.stop>
              <div class="flex justify-end gap-2">
                <Button size="sm" variant="outline" as-child>
                  <NuxtLink :to="`/agents/${agent.id}/edit`">Edit</NuxtLink>
                </Button>
                <Button size="sm" variant="outline" @click="onRestart(agent)">
                  Restart
                </Button>
                <Button size="sm" variant="ghost" class="text-destructive" @click="pendingRemoval = agent">
                  Delete
                </Button>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <div v-else class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
      No agents yet.
    </div>

    <ConfirmDialog
      v-model:open="confirmRemoveOpen"
      title="Delete agent"
      :description="pendingRemoval ? `Permanently delete agent “${pendingRemoval.name}”? This cannot be undone.` : ''"
      confirm-label="Delete agent"
      @confirm="onRemove"
    />
  </div>
</template>
