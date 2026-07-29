<script setup lang="ts">
import type { AgentStatusTypes, IAgentData } from '#agent/stores/agent';
import {
  IconDotsVertical,
  IconLoader2,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconShield,
  IconTrash,
} from '@tabler/icons-vue';

const agentStore = useAgentStore();

const { data: agents, pending, refresh } = await useAsyncData(
  'admin-agents',
  () => agentStore.fetchAll(),
);

// Cluster headroom for new agents. Store actions (create/remove/restart/
// stop/start) refetch on their own; the interval catches pods actually
// scheduling and other operators' changes. The API caches ~15s, so polling
// is cheap. Null (K8s unreachable) simply hides the badge.
const capacity = computed(() => agentStore.capacity);

let capacityTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  void agentStore.fetchCapacity();
  capacityTimer = setInterval(() => void agentStore.fetchCapacity(), 30_000);
});
onUnmounted(() => {
  if (capacityTimer) clearInterval(capacityTimer);
});

// Per-row "restarting" guard so the button shows a spinner without blocking
// other rows. The store's restart() does an optimistic status flip, so the
// row's badge changes immediately even before the API resolves.
const restartingIds = ref<Set<string>>(new Set());

function isRestarting(id: string): boolean {
  return restartingIds.value.has(id);
}

async function onRestart(agent: IAgentData) {
  if (restartingIds.value.has(agent.id)) return;
  restartingIds.value = new Set([...restartingIds.value, agent.id]);
  try {
    await agentStore.restart(agent.id);
    await refresh();
  } finally {
    const next = new Set(restartingIds.value);
    next.delete(agent.id);
    restartingIds.value = next;
  }
}

// Statuses that consume cluster resources (a pod is or will be running) — the
// only states where "Stop" makes sense. Everything else gets "Start".
const RESOURCE_HOLDING: ReadonlySet<AgentStatusTypes> = new Set([
  'running',
  'deploying',
  'pending',
]);

function canStop(status: AgentStatusTypes): boolean {
  return RESOURCE_HOLDING.has(status);
}

// Per-row busy guard for stop/start so one row's spinner doesn't block others.
const togglingIds = ref<Set<string>>(new Set());

function isToggling(id: string): boolean {
  return togglingIds.value.has(id);
}

async function onToggleRunning(agent: IAgentData) {
  if (togglingIds.value.has(agent.id)) return;
  togglingIds.value = new Set([...togglingIds.value, agent.id]);
  try {
    if (canStop(agent.status)) {
      await agentStore.stop(agent.id);
    } else {
      await agentStore.start(agent.id);
    }
    await refresh();
  } finally {
    const next = new Set(togglingIds.value);
    next.delete(agent.id);
    togglingIds.value = next;
  }
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
      <div class="flex items-center gap-3">
        <div
          v-if="capacity"
          class="hidden sm:flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground"
          title="How many more agents fit on the cluster (by CPU/memory requests on agent nodes)"
        >
          <span
            :class="
              capacity.freeAgentSlots === 0
                ? 'font-medium text-amber-600'
                : 'font-medium text-foreground'
            "
          >
            {{ capacity.freeAgentSlots }}
          </span>
          {{ capacity.freeAgentSlots === 1 ? 'slot' : 'slots' }} free
        </div>
        <Button as-child>
          <NuxtLink to="/agents/create">New agent</NuxtLink>
        </Button>
      </div>
    </div>

    <!-- Capacity is a ~15s-stale estimate, so this warns rather than blocks:
         creating is still legal, the pod just waits Pending for a slot. -->
    <p
      v-if="capacity && capacity.freeAgentSlots === 0"
      class="text-xs text-amber-600"
    >
      {{
        capacity.totalAgentSlots === 0
          ? 'No agent nodes available in this cluster (no schedulable node labeled node-role=agents) — new agents will stay Pending.'
          : 'Cluster is full — stop an agent to free a slot before starting a new one.'
      }}
    </p>

    <!-- Skeleton on initial load only. Refreshes after Restart/Delete keep
         the existing rows visible to avoid the page-flash effect. -->
    <div v-if="pending && !agents" class="rounded-md border bg-card p-2">
      <div
        v-for="i in 4"
        :key="i"
        class="flex items-center gap-4 px-2 py-3 border-b last:border-b-0"
      >
        <Skeleton class="h-4 w-40" />
        <Skeleton class="h-4 w-24" />
        <Skeleton class="h-5 w-20 rounded-full" />
        <Skeleton class="ml-auto h-8 w-32" />
      </div>
    </div>

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
            <TableCell class="font-medium">
              <div class="flex items-center gap-2">
                <span>{{ agent.name }}</span>
                <Badge v-if="agent.isAdmin" variant="default" class="gap-1" title="This agent has the ranch_* admin tools and a service token">
                  <IconShield class="size-3" /> Admin
                </Badge>
              </div>
            </TableCell>
            <TableCell class="text-muted-foreground">
              {{ agent.resources.cpu }} / {{ agent.resources.memory }}
            </TableCell>
            <TableCell>
              <Badge :variant="AGENT_STATUS_VARIANT[agent.status]" class="capitalize">
                {{ agent.status }}
              </Badge>
            </TableCell>
            <TableCell class="text-muted-foreground">{{ formatDateTime(agent.createdAt) }}</TableCell>
            <TableCell @click.stop>
              <div class="flex justify-end gap-2">
                <Button size="sm" variant="outline" as-child>
                  <NuxtLink :to="`/agents/${agent.id}/edit`">Edit</NuxtLink>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button size="sm" variant="ghost" class="size-8 p-0">
                      <span class="sr-only">Open menu</span>
                      <IconDotsVertical class="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      :disabled="isRestarting(agent.id) || isToggling(agent.id)"
                      @select="onRestart(agent)"
                    >
                      <IconLoader2
                        v-if="isRestarting(agent.id)"
                        class="size-4 animate-spin"
                      />
                      <IconRefresh v-else class="size-4" />
                      {{ isRestarting(agent.id) ? 'Restarting…' : 'Restart' }}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      :disabled="isToggling(agent.id) || isRestarting(agent.id)"
                      @select="onToggleRunning(agent)"
                    >
                      <IconLoader2
                        v-if="isToggling(agent.id)"
                        class="size-4 animate-spin"
                      />
                      <IconPlayerStop v-else-if="canStop(agent.status)" class="size-4" />
                      <IconPlayerPlay v-else class="size-4" />
                      {{
                        isToggling(agent.id)
                          ? canStop(agent.status)
                            ? 'Stopping…'
                            : 'Starting…'
                          : canStop(agent.status)
                            ? 'Stop'
                            : 'Start'
                      }}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      class="text-destructive focus:text-destructive"
                      @select="pendingRemoval = agent"
                    >
                      <IconTrash class="size-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
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
