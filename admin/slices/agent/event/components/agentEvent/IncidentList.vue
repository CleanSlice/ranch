<script setup lang="ts">
import { IconChevronRight } from '@tabler/icons-vue';
import type { IAgentIncident } from '#agentEvent/domain';
import { TONE_CLASSES, deliveryState, incidentTone } from '#agentEvent/utils/eventTone';
import { formatDateTime, formatSpan, formatStamp } from '#common/utils/format';

/**
 * Incidents, one row each: what is (or was) wrong with which agent, since
 * when, who saw it, whether the team was told. A row opens into the reports
 * that make it up. This is the page's main view — twenty reports about one
 * crash loop are one line here, and the raw reports are a click away.
 *
 * Rows are drawn by id from the store (docs/state.md).
 */
const props = defineProps<{
  ids: string[];
}>();

const store = useAgentEventStore();

const rows = computed<IAgentIncident[]>(() => {
  const out: IAgentIncident[] = [];
  for (let i = 0; i < props.ids.length; i += 1) {
    const incident = store.incidentById(props.ids[i]!);
    if (incident) out.push(incident);
  }
  return out;
});

const expanded = ref<Set<string>>(new Set());
const isOpen = (id: string) => expanded.value.has(id);

function toggle(id: string) {
  const next = new Set(expanded.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
    void store.fetchIncidentEvents(id).catch(() => {});
  }
  expanded.value = next;
}

// An open row's reports are re-read when the incident gains one — the count
// comes with the 5-second refresh of the list — and not on every beat.
const expandedCounts = computed(() =>
  rows.value
    .filter((i) => expanded.value.has(i.id))
    .map((i) => `${i.id}:${i.eventCount}`)
    .join(','),
);
watch(expandedCounts, (now, before) => {
  const had = new Set(before ? before.split(',') : []);
  for (const key of now ? now.split(',') : []) {
    if (!had.has(key)) void store.fetchIncidentEvents(key.split(':')[0]!).catch(() => {});
  }
});

/** "1 report" / "6 reports" — every event of the incident, from any sender. */
const reports = (n: number) => `${n} ${n === 1 ? 'report' : 'reports'}`;

/** The message sent when the incident closed, if one was. */
function closingDelivery(incident: IAgentIncident) {
  return incident.state === 'closed' ? deliveryState(incident.notifications, 'closed') : null;
}

/** How long the agent was down, for an incident that ended in a recovery. */
function downFor(incident: IAgentIncident): string | null {
  if (incident.resolution !== 'recovered') return null;
  return formatSpan(incident.openedAt, incident.upSince ?? incident.lastFailureAt);
}
</script>

<template>
  <div class="overflow-hidden rounded-lg border">
    <div
      v-for="incident in rows"
      :key="incident.id"
      class="border-b last:border-b-0"
    >
      <div
        class="flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
        @click="toggle(incident.id)"
      >
        <button
          type="button"
          class="mt-0.5 rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :aria-expanded="isOpen(incident.id)"
          :aria-label="`${isOpen(incident.id) ? 'Hide' : 'Show'} the reports for ${incident.agentName}`"
          @click.stop="toggle(incident.id)"
        >
          <IconChevronRight
            class="size-4 transition-transform"
            :class="isOpen(incident.id) ? 'rotate-90' : ''"
          />
        </button>

        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge variant="outline" :class="TONE_CLASSES[incidentTone(incident).tone]">
              {{ incidentTone(incident).label }}
            </Badge>
            <NuxtLink
              v-if="incident.agentId"
              :to="`/agents/${incident.agentId}?tab=events`"
              class="font-medium hover:underline"
              @click.stop
            >
              {{ incident.agentName }}
            </NuxtLink>
            <span v-else class="font-medium">{{ incident.agentName }}</span>
            <span class="text-xs text-muted-foreground">
              {{ reports(incident.eventCount) }}
            </span>
          </div>

          <!-- The first cause, as received; one line here, whole on hover
               and in the reports below. -->
          <div
            v-if="incident.reason"
            class="mt-1 truncate font-mono text-xs"
            :title="incident.reason"
          >
            {{ incident.reason }}
          </div>

          <div class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span v-if="incident.state === 'open'" :title="formatDateTime(incident.openedAt)">
              Since {{ formatStamp(incident.openedAt) }} ·
              {{ formatSpan(incident.openedAt, store.refreshedAt) }}
            </span>
            <span v-else :title="formatDateTime(incident.openedAt)">
              {{ formatStamp(incident.openedAt) }}
              <template v-if="incident.closedAt">
                → {{ formatStamp(incident.closedAt) }}
              </template>
              <template v-if="downFor(incident)"> · down {{ downFor(incident) }}</template>
            </span>
            <span
              v-if="incident.state === 'open' && incident.upSince"
              :title="formatDateTime(incident.upSince)"
            >
              Up since {{ formatStamp(incident.upSince) }} — closes after ten
              quiet minutes
            </span>
            <span>Reported by {{ incident.witnesses.join(', ') }}</span>
          </div>
        </div>

        <div class="flex shrink-0 flex-col items-end gap-1">
          <AgentEventDeliveryBadge :notifications="incident.notifications" />
          <span
            v-if="closingDelivery(incident)"
            class="text-xs text-muted-foreground"
            :title="closingDelivery(incident)?.detail"
          >
            Closing message: {{ closingDelivery(incident)?.label.toLowerCase() }}
          </span>
        </div>
      </div>

      <div v-if="isOpen(incident.id)" class="border-t bg-muted/20 px-4 py-3">
        <p
          v-if="store.incidentEventIds(incident.id) === undefined"
          class="text-sm text-muted-foreground"
        >
          Loading reports…
        </p>
        <AgentEventTable
          v-else
          :ids="store.incidentEventIds(incident.id)"
          timeline
        />
      </div>
    </div>
  </div>
</template>
