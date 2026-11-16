<script setup lang="ts">
import type {
  IAgentLoad,
  IAgentLoadWindow,
  LimitWindowTypes,
} from '#agent/domain/agentLimit.types';
import { formatRoomIn } from '#agent/utils/agentLimitForm';
import { formatNumber, formatStamp } from '#common/utils/format';

// Renders the snapshot it is handed; `load/Provider.vue` reads it from the
// limit store by agent id (docs/state.md) and keeps it fresh.
const props = defineProps<{ load: IAgentLoad }>();

const WINDOW_LABELS: Record<LimitWindowTypes, string> = {
  minute: 'Last 60 seconds',
  hour: 'Last 60 minutes',
  day: 'Last 24 hours',
};

const PEAK_LABELS: Record<LimitWindowTypes, string> = {
  minute: 'busiest minute',
  hour: 'busiest hour',
  day: 'busiest day',
};

function isFull(w: IAgentLoadWindow): boolean {
  return w.retryAfterSec !== null;
}

// A full window is the state the operator is looking for, so it gets the
// alarm colour whatever the percentage rounds to.
function fillClass(w: IAgentLoadWindow): string {
  if (isFull(w)) return 'bg-destructive';
  return usagePctClass(usagePct(w.used, w.limit ?? 0));
}

const refusedBy = computed(() => {
  const by = props.load.refused.byWindow;
  const parts: string[] = [];
  if (by.minute) parts.push(`${formatNumber(by.minute)} by the minute limit`);
  if (by.hour) parts.push(`${formatNumber(by.hour)} by the hour limit`);
  if (by.day) parts.push(`${formatNumber(by.day)} by the day limit`);
  return parts.join(', ');
});

// Browser-local time on the admin's 24-hour clock; the day is added when the
// last refusal was not today.
const lastRefusedAt = computed(() => formatStamp(props.load.refused.lastAt));
</script>

<template>
  <div class="grid gap-5">
    <p
      v-if="load.apiReplicas > 1"
      class="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
      role="status"
      data-load-partial
    >
      Partial figures: the API is running {{ load.apiReplicas }} copies and
      each counts on its own. What you see is the share of one copy.
    </p>

    <div class="grid gap-4 sm:grid-cols-3">
      <div
        v-for="w in load.windows"
        :key="w.window"
        :data-load-window="w.window"
        :data-used="w.used"
        :data-limit="w.limit ?? ''"
        :data-full="isFull(w) ? 'true' : 'false'"
      >
        <div class="mb-1 flex items-baseline justify-between gap-2 text-sm">
          <span class="font-medium">{{ WINDOW_LABELS[w.window] }}</span>
          <span class="font-mono text-xs text-muted-foreground">
            {{ formatNumber(w.used) }} /
            {{ w.limit !== null ? formatNumber(w.limit) : 'no limit' }}
          </span>
        </div>

        <!-- With a limit: how much of it is used. Without one there is no
             ceiling to draw, and a bar would invent one. -->
        <div
          v-if="w.limit !== null"
          class="h-2 w-full overflow-hidden rounded bg-muted"
          role="progressbar"
          :aria-label="`${WINDOW_LABELS[w.window]}: ${w.used} of ${w.limit} requests used`"
          aria-valuemin="0"
          :aria-valuemax="w.limit"
          :aria-valuenow="Math.min(w.used, w.limit)"
        >
          <div
            class="h-full transition-all"
            :class="fillClass(w)"
            :style="{ width: usagePct(w.used, w.limit) + '%' }"
          />
        </div>
        <div
          v-else
          class="h-2 w-full rounded border border-dashed border-muted-foreground/40"
          aria-hidden="true"
        />

        <p
          v-if="w.retryAfterSec !== null"
          class="mt-1 text-xs font-medium text-destructive"
          data-load-room
        >
          Full — room again in {{ formatRoomIn(w.retryAfterSec) }}
        </p>
        <p
          v-if="load.peaks[w.window] > 0"
          class="mt-1 text-xs text-muted-foreground"
          :title="`Most requests accepted in any such window of the last 30 days`"
          :data-load-peak="w.window"
        >
          {{ PEAK_LABELS[w.window] }} in 30 days:
          {{ formatNumber(load.peaks[w.window]) }}
        </p>
      </div>
    </div>

    <dl class="grid gap-3 text-sm sm:grid-cols-3">
      <div>
        <dt class="text-xs text-muted-foreground">In progress right now</dt>
        <dd class="mt-0.5">
          <span class="font-mono" data-load-inflight>{{ load.inFlight }}</span>
          <span class="ml-1 text-xs text-muted-foreground">
            {{ load.inFlight === 1 ? 'request being answered' : 'requests being answered' }}
          </span>
        </dd>
      </div>

      <div data-load-refused :data-count="load.refused.lastHour">
        <dt class="text-xs text-muted-foreground">Refused in the last hour</dt>
        <dd class="mt-0.5">
          <span class="font-mono" :class="load.refused.lastHour > 0 && 'text-destructive'">
            {{ formatNumber(load.refused.lastHour) }}
          </span>
          <span v-if="lastRefusedAt" class="ml-1 text-xs text-muted-foreground">
            latest at {{ lastRefusedAt }}
          </span>
          <span v-if="refusedBy" class="block text-xs text-muted-foreground">
            {{ refusedBy }}
          </span>
        </dd>
      </div>

      <div data-load-exempt :data-count="load.exemptLastHour">
        <dt class="text-xs text-muted-foreground">
          Operators and other agents, last hour
        </dt>
        <dd class="mt-0.5">
          <span class="font-mono">{{ formatNumber(load.exemptLastHour) }}</span>
          <span class="ml-1 text-xs text-muted-foreground">
            not counted toward the limits
          </span>
        </dd>
      </div>
    </dl>
  </div>
</template>
