<script setup lang="ts">
// How busy this agent is right now (CLEAN-224, User Story 3): usage against
// each limit, requests in progress, the last hour minute by minute, refusals.
// Works the same for an agent with limits off — the load is shown with no
// ceiling, which is what there is to choose limits from.
const props = defineProps<{ agentId: string }>();

const limitStore = useAgentLimitStore();

// Rendered from the store's record for this agent (docs/state.md); the poll
// below only keeps that record fresh. The "Visibility & embed" card under
// this one reads the same record for "highest seen".
const load = computed(() => limitStore.byAgent[props.agentId]?.load ?? null);

// Every 3 s while this card is mounted AND the tab is visible (FR-046): the
// store stops the timer in a hidden tab and asks again the moment it is shown.
let stopWatching: (() => void) | null = null;
onMounted(() => {
  stopWatching = limitStore.watchLoad(props.agentId);
});
onBeforeUnmount(() => {
  stopWatching?.();
  stopWatching = null;
});
</script>

<template>
  <Card data-load-view>
    <CardHeader>
      <CardTitle>Request load</CardTitle>
      <CardDescription>
        Requests from visitors, counted against this agent's limits. Live:
        refreshes every 3 seconds while this tab is open.
        <template v-if="load && !load.limits">
          Limits are off, so nothing is refused — the figures below are what
          to choose limits from.
        </template>
      </CardDescription>
    </CardHeader>
    <CardContent>
      <div v-if="!load" class="space-y-4">
        <Skeleton class="h-12 w-full" />
        <Skeleton class="h-32 w-full" />
      </div>
      <div v-else class="grid gap-6">
        <AgentLoadMeters :load="load" />
        <AgentLoadChart
          :series="load.series"
          :per-minute-limit="load.limits?.perMinute ?? null"
        />
      </div>
    </CardContent>
  </Card>
</template>
