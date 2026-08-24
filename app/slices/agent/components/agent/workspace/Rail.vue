<script setup lang="ts">
import type { IAgentData, IClusterCapacityData } from '#agent/domain';

const props = defineProps<{
  agents: IAgentData[] | null | undefined;
  activeId: string;
  /** Initial load only — a refresh keeps the existing rows visible. */
  pending: boolean;
  /** Owner/Admin only — everyone else gets no create action and no capacity,
   *  which is the rule the cards screen already applied. */
  canCreate: boolean;
  capacity: IClusterCapacityData | null;
}>();

defineEmits<{ select: [id: string] }>();

// Transient by design: a filter that survived a reload would leave someone
// staring at a list missing agents with no memory of why.
const search = ref('');

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase();
  const list = props.agents ?? [];
  return term ? list.filter((a) => a.name.toLowerCase().includes(term)) : list;
});

const hasAgents = computed(() => (props.agents?.length ?? 0) > 0);
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2">
    <div class="relative shrink-0">
      <Icon
        name="search"
        :size="14"
        class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      <input
        v-model="search"
        type="search"
        :placeholder="$t('rail.search')"
        :aria-label="$t('rail.search')"
        class="w-full rounded-md border bg-transparent py-1.5 pl-8 pr-2 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      />
    </div>

    <!-- Placeholder rows rather than an empty column while the list loads. -->
    <div v-if="pending && !hasAgents" class="flex flex-col gap-1">
      <div v-for="i in 5" :key="i" class="flex items-center gap-3 px-2.5 py-2">
        <div class="h-9 w-9 shrink-0 animate-pulse rounded-lg bg-muted" />
        <div class="flex-1 space-y-1.5">
          <div class="h-3.5 w-28 animate-pulse rounded bg-muted" />
          <div class="h-3 w-20 animate-pulse rounded bg-muted/70" />
        </div>
      </div>
    </div>

    <div v-else-if="filtered.length" class="min-h-0 flex-1 overflow-y-auto">
      <ul class="flex flex-col gap-0.5">
        <li v-for="agent in filtered" :key="agent.id">
          <AgentWorkspaceRailItem
            :agent="agent"
            :active="agent.id === activeId"
            @click="$emit('select', agent.id)"
          />
        </li>
      </ul>
    </div>

    <p
      v-else-if="hasAgents"
      class="min-h-0 flex-1 px-2.5 py-6 text-center text-xs text-muted-foreground"
    >
      {{ $t('rail.no_match', { term: search }) }}
    </p>

    <p
      v-else
      class="min-h-0 flex-1 px-2.5 py-6 text-center text-xs text-muted-foreground"
    >
      {{ $t('rail.empty') }}
    </p>

    <!-- Pinned to the floor: creating an agent belongs with the list of
         agents, and the capacity line belongs with the create action. -->
    <div v-if="canCreate" class="shrink-0 border-t pt-2">
      <p
        v-if="capacity"
        class="px-1 pb-2 text-xs"
        :class="
          capacity.freeAgentSlots === 0
            ? 'font-medium text-amber-600'
            : 'text-muted-foreground'
        "
      >
        {{
          $t(
            'list.slots_free',
            { count: capacity.freeAgentSlots },
            capacity.freeAgentSlots,
          )
        }}
      </p>

      <NuxtLink
        to="/agents/create"
        class="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-95"
      >
        <Icon name="plus" :size="13" />
        {{ $t('list.create') }}
      </NuxtLink>
    </div>
  </div>
</template>
