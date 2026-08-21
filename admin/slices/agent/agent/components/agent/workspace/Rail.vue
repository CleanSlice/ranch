<script setup lang="ts">
import { IconPlus, IconSearch } from '@tabler/icons-vue';
import type { IAgentData, IClusterCapacityData } from '#agent/domain';
import { useAgentRailEntries } from '#agent/composables/useAgentRailEntries';

const props = defineProps<{
  agents: IAgentData[] | null | undefined;
  activeId: string;
  /** Initial load only — a refresh keeps the existing rows visible. */
  pending: boolean;
  /** Null when Kubernetes is unreachable — the line simply does not render
   *  rather than showing a number nobody can trust. */
  capacity: IClusterCapacityData | null;
}>();

defineEmits<{ select: [id: string] }>();

// Transient by design: a filter that survived a reload would leave someone
// staring at a rail missing agents with no memory of why.
const search = ref('');

const agentsRef = computed(() => props.agents);
const activeIdRef = computed(() => props.activeId);
const entries = useAgentRailEntries(agentsRef, activeIdRef, search);

const hasAgents = computed(() => (props.agents?.length ?? 0) > 0);

const clusterFull = computed(() => props.capacity?.freeAgentSlots === 0);
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2">
    <div class="relative shrink-0">
      <IconSearch
        class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        v-model="search"
        type="search"
        placeholder="Search agents"
        aria-label="Search agents"
        class="h-8 pl-8 text-sm"
      />
    </div>

    <!-- Placeholder rows rather than an empty column while the list loads,
         matching the treatment the table used (FR-027). -->
    <div v-if="pending && !hasAgents" class="flex flex-col gap-1">
      <div
        v-for="i in 5"
        :key="i"
        class="flex items-center gap-3 px-2.5 py-2"
      >
        <Skeleton class="size-9 shrink-0 rounded-lg" />
        <div class="flex-1 space-y-1.5">
          <Skeleton class="h-3.5 w-28" />
          <Skeleton class="h-3 w-20" />
        </div>
      </div>
    </div>

    <div v-else-if="entries.length" class="min-h-0 flex-1 overflow-y-auto">
      <ul class="flex flex-col gap-0.5">
        <li v-for="entry in entries" :key="entry.id">
          <AgentWorkspaceRailItem
            :entry="entry"
            @click="$emit('select', entry.id)"
          />
        </li>
      </ul>
    </div>

    <p
      v-else-if="hasAgents"
      class="min-h-0 flex-1 px-2.5 py-6 text-center text-xs text-muted-foreground"
    >
      No agent matches “{{ search }}”.
    </p>

    <p
      v-else
      class="min-h-0 flex-1 px-2.5 py-6 text-center text-xs text-muted-foreground"
    >
      No agents yet.
    </p>

    <!-- Pinned to the floor of the rail. Creating an agent belongs with the
         list of agents, and the capacity line belongs with the create action —
         it is the number that answers "can I, right now?". -->
    <div class="shrink-0 border-t pt-2">
      <p
        v-if="capacity"
        class="px-1 pb-2 text-xs"
        :class="clusterFull ? 'text-amber-600' : 'text-muted-foreground'"
      >
        <span class="font-medium">{{ capacity.freeAgentSlots }}</span>
        {{ capacity.freeAgentSlots === 1 ? 'slot' : 'slots' }} free
        <!-- Capacity is a ~15s-stale estimate, so this warns rather than
             blocks: creating is still legal, the pod just waits Pending. -->
        <template v-if="clusterFull">
          —
          {{
            capacity.totalAgentSlots === 0
              ? 'no schedulable agent nodes in this cluster, so new agents will stay Pending.'
              : 'stop an agent to free a slot before starting a new one.'
          }}
        </template>
      </p>

      <Button size="sm" class="w-full" as-child>
        <NuxtLink to="/agents/create">
          <IconPlus class="size-4" />
          New agent
        </NuxtLink>
      </Button>
    </div>
  </div>
</template>
