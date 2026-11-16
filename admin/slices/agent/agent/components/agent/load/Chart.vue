<script setup lang="ts">
import type { IAgentLoadMinute } from '#agent/domain/agentLimit.types';
import { formatClock, formatNumber } from '#common/utils/format';

// The last hour, one bar per minute: accepted with refused stacked on top,
// and a line at the per-minute limit when there is one.
//
// Drawn as plain elements rather than through the `@unovis/vue` wrappers in
// `#theme/components/ui/chart`: unovis owns its SVG and gives no way to put
// attributes on a bar, and the browser tests read each bar's `data-minute`,
// `data-accepted` and `data-refused`. Sixty divs also re-render in place
// every 3 s without a chart library re-measuring anything.
const props = defineProps<{
  series: IAgentLoadMinute[];
  /** `null`: the minute window is not limited, so no line is drawn. */
  perMinuteLimit: number | null;
}>();

// One scale for bars and line: the tallest minute, or the limit when it is
// higher — so the line is always inside the plot and a quiet hour does not
// look like a busy one.
const scaleMax = computed(() => {
  let max = 1;
  for (let i = 0; i < props.series.length; i += 1) {
    const total = props.series[i]!.accepted + props.series[i]!.refused;
    if (total > max) max = total;
  }
  if (props.perMinuteLimit !== null && props.perMinuteLimit > max) {
    max = props.perMinuteLimit;
  }
  return max;
});

function pct(value: number): string {
  return `${Math.min(100, (value / scaleMax.value) * 100)}%`;
}

const limitBottom = computed(() =>
  props.perMinuteLimit === null ? null : pct(props.perMinuteLimit),
);

const hasTraffic = computed(() =>
  props.series.some((m) => m.accepted > 0 || m.refused > 0 || m.exempt > 0),
);

const totals = computed(() => {
  let accepted = 0;
  let refused = 0;
  for (let i = 0; i < props.series.length; i += 1) {
    accepted += props.series[i]!.accepted;
    refused += props.series[i]!.refused;
  }
  return { accepted, refused };
});

// The minute under the pointer or the keyboard focus, read out in words above
// the plot — sixty 6-pixel bars cannot each carry a label.
const activeIndex = ref<number | null>(null);
const active = computed(() =>
  activeIndex.value === null ? null : props.series[activeIndex.value] ?? null,
);

function describe(m: IAgentLoadMinute): string {
  const parts = [
    `${formatNumber(m.accepted)} accepted`,
    `${formatNumber(m.refused)} refused`,
  ];
  if (m.exempt > 0) parts.push(`${formatNumber(m.exempt)} not counted`);
  return `${formatClock(m.minute)} — ${parts.join(', ')}`;
}

const firstLabel = computed(() => formatClock(props.series[0]?.minute));
const midLabel = computed(() =>
  formatClock(props.series[Math.floor(props.series.length / 2)]?.minute),
);
const lastLabel = computed(() =>
  formatClock(props.series[props.series.length - 1]?.minute),
);

// The same figures as rows, for a screen reader and for anyone who wants the
// numbers rather than the picture. Quiet minutes are left out.
const tableRows = computed(() =>
  props.series.filter((m) => m.accepted > 0 || m.refused > 0 || m.exempt > 0),
);
</script>

<template>
  <figure
    class="grid gap-2"
    data-load-chart
    :data-limit="perMinuteLimit ?? ''"
    :data-scale-max="scaleMax"
  >
    <figcaption class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
      <span class="font-medium text-foreground">Requests per minute, last hour</span>
      <!-- Identity is never colour alone: each swatch has its word, and the
           refused swatch is hatched as well as coloured. -->
      <span class="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        <span class="flex items-center gap-1.5">
          <span class="size-2.5 rounded-xs bg-primary" aria-hidden="true" />
          Accepted ({{ formatNumber(totals.accepted) }})
        </span>
        <span class="flex items-center gap-1.5">
          <span class="load-refused size-2.5 rounded-xs" aria-hidden="true" />
          Refused ({{ formatNumber(totals.refused) }})
        </span>
        <span v-if="perMinuteLimit !== null" class="flex items-center gap-1.5">
          <span class="w-4 border-t border-dashed border-foreground/70" aria-hidden="true" />
          Limit per minute ({{ formatNumber(perMinuteLimit) }})
        </span>
      </span>
    </figcaption>

    <p class="h-4 text-xs text-muted-foreground" aria-live="off" data-load-chart-readout>
      {{ active ? describe(active) : hasTraffic ? 'Point at a bar for its minute.' : 'No requests in the last hour.' }}
    </p>

    <div class="flex gap-2">
      <div
        class="flex h-32 w-8 shrink-0 flex-col justify-between text-right font-mono text-[10px] leading-none text-muted-foreground"
        aria-hidden="true"
      >
        <span>{{ formatNumber(scaleMax) }}</span>
        <span>0</span>
      </div>

      <div class="min-w-0 flex-1">
        <div
          class="relative flex h-32 items-end gap-px border-b border-border"
          role="img"
          :aria-label="`Requests per minute over the last hour: ${formatNumber(totals.accepted)} accepted, ${formatNumber(totals.refused)} refused.`"
          @mouseleave="activeIndex = null"
        >
          <!-- A column is the hit target, full height, so a one-request
               minute is as easy to point at as a busy one. -->
          <div
            v-for="(m, i) in series"
            :key="m.minute"
            class="flex h-full min-w-0 flex-1 flex-col justify-end gap-px"
            :class="activeIndex === i && 'bg-muted'"
            :title="describe(m)"
            :data-minute="m.minute"
            :data-accepted="m.accepted"
            :data-refused="m.refused"
            :data-exempt="m.exempt"
            @mouseenter="activeIndex = i"
          >
            <div
              v-if="m.refused > 0"
              class="load-refused w-full rounded-t-xs"
              :style="{ height: pct(m.refused), minHeight: '2px' }"
            />
            <div
              v-if="m.accepted > 0"
              class="w-full bg-primary"
              :class="m.refused > 0 ? '' : 'rounded-t-xs'"
              :style="{ height: pct(m.accepted), minHeight: '2px' }"
            />
          </div>

          <div
            v-if="limitBottom !== null"
            class="pointer-events-none absolute inset-x-0 border-t border-dashed border-foreground/70"
            :style="{ bottom: limitBottom }"
            data-load-chart-limit
          />
        </div>

        <div
          class="mt-1 flex justify-between font-mono text-[10px] leading-none text-muted-foreground"
          aria-hidden="true"
        >
          <span>{{ firstLabel }}</span>
          <span>{{ midLabel }}</span>
          <span>{{ lastLabel }}</span>
        </div>
      </div>
    </div>

    <table class="sr-only">
      <caption>Requests per minute over the last hour, minutes with traffic only</caption>
      <thead>
        <tr>
          <th scope="col">Minute</th>
          <th scope="col">Accepted</th>
          <th scope="col">Refused</th>
          <th scope="col">Not counted</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="m in tableRows" :key="m.minute">
          <th scope="row">{{ formatClock(m.minute) }}</th>
          <td>{{ m.accepted }}</td>
          <td>{{ m.refused }}</td>
          <td>{{ m.exempt }}</td>
        </tr>
      </tbody>
    </table>
  </figure>
</template>

<style scoped>
/* Refused: the alarm colour AND a hatch, so the two segments of a bar differ
   for a reader who cannot tell the hues apart, and in a forced-colours mode. */
.load-refused {
  background-color: var(--destructive);
  background-image: repeating-linear-gradient(
    135deg,
    transparent 0 2px,
    color-mix(in oklab, var(--background) 55%, transparent) 2px 4px
  );
}
</style>
