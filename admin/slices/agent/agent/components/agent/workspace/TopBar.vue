<script setup lang="ts">
import type { IClusterCapacityData } from '#agent/domain';

// `capacity` is null both when Kubernetes is unreachable and when the viewer
// cannot fetch it at all (the endpoint is Owner/Admin only) — in either case
// the badge simply does not render rather than showing a wrong number.
defineProps<{ capacity: IClusterCapacityData | null }>();
</script>

<template>
  <!-- The row that used to hold "← Back to agents", which has nothing left to
       link back to now the table is gone. Workspace-level actions live here;
       per-agent actions live in the settings panel (FR-009). -->
  <div class="flex shrink-0 flex-wrap items-center gap-3">
    <div
      v-if="capacity"
      class="hidden items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground sm:flex"
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

    <div class="ml-auto">
      <Button size="sm" as-child>
        <NuxtLink to="/agents/create">New agent</NuxtLink>
      </Button>
    </div>
  </div>
</template>
