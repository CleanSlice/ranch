<script setup lang="ts">
import {
  IconActivity,
  IconChartBar,
  IconChevronLeft,
  IconChevronRight,
} from '@tabler/icons-vue';
import type { IUsageDailyEntry } from '#usage/domain';
import { formatCount, formatUsd } from '#agent/utils/agentFormat';

// Host classes (flex sizing in side stacks / the chat header strip) must
// land on the visible root — Card, collapsed button, or strip — not a wrapper.
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    /** Scope of the Agent view. null = no subject agent (tab disabled). */
    agentId: string | null;
    title?: string;
    /** When true the panel can collapse into a compact button (side stacks). */
    collapsible?: boolean;
    /**
     * Single-agent surfaces (agent chat side stack, Overview tab): no tab
     * strip, the view is fixed to Agent and the workspace overview is never
     * fetched.
     */
    agentOnly?: boolean;
    /**
     * `strip` — one thin header line (agent chat). `panel` — the full card
     * (Overview, Rancher). Collapsible is ignored in strip mode.
     */
    variant?: 'panel' | 'strip';
  }>(),
  { title: 'Usage · 30d', collapsible: false, agentOnly: false, variant: 'panel' },
);

type UsageView = 'total' | 'calls' | 'agent';

const usageStore = useUsageStore();

// Both sources are fetched lazily on mount: the default Total view needs the
// overview, and the Agent view (plus its today snapshot) is one cheap call —
// prefetching it makes view switches instant. In agentOnly mode the overview
// backs no visible view, so its request is never issued.
const {
  data: overview,
  pending: overviewPending,
  error: overviewError,
  refresh: refreshOverview,
} = useAsyncData('usage-panel-overview', () => usageStore.fetchOverview(), {
  lazy: true,
  immediate: !props.agentOnly,
});

const {
  data: agentUsage,
  pending: agentPending,
  error: agentError,
  refresh: refreshAgent,
} = useAsyncData(
  `usage-panel-agent-${props.agentId ?? 'none'}`,
  async () => (props.agentId ? usageStore.fetchForAgent(props.agentId) : null),
  { lazy: true },
);

const view = ref<UsageView>(props.agentOnly ? 'agent' : 'total');
const collapsed = ref(false);

// Total view's By agent list: top spenders first, capped so a workspace with
// many agents can't stretch the card (Rancher page); the rest sits behind an
// explicit toggle.
const BY_AGENT_LIMIT = 5;
const byAgentExpanded = ref(false);
const byAgentSorted = computed(() =>
  [...(overview.value?.byAgent ?? [])].sort((a, b) => b.costUsd - a.costUsd),
);
const byAgentShown = computed(() =>
  byAgentExpanded.value
    ? byAgentSorted.value
    : byAgentSorted.value.slice(0, BY_AGENT_LIMIT),
);

const PAGE_SIZE = 7;
const page = ref(1);
watch(view, () => {
  page.value = 1;
});

const activeDaily = computed<IUsageDailyEntry[]>(() => {
  if (view.value === 'agent') return agentUsage.value?.last30days ?? [];
  return overview.value?.last30days ?? [];
});
const totalRows = computed(() => activeDaily.value.length);
const pageCount = computed(() =>
  Math.max(1, Math.ceil(totalRows.value / PAGE_SIZE)),
);
const pagedDaily = computed(() =>
  activeDaily.value.slice(
    (page.value - 1) * PAGE_SIZE,
    page.value * PAGE_SIZE,
  ),
);
const rangeLabel = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE + 1;
  const end = Math.min(page.value * PAGE_SIZE, totalRows.value);
  return `${start}–${end} of ${totalRows.value}`;
});

const activePending = computed(() =>
  view.value === 'agent'
    ? agentPending.value && !agentUsage.value
    : overviewPending.value && !overview.value,
);
const activeError = computed(() =>
  view.value === 'agent' ? agentError.value : overviewError.value,
);
const activeEmpty = computed(() => {
  if (view.value === 'agent') {
    return !agentUsage.value || agentUsage.value.totals.callCount === 0;
  }
  return !overview.value || overview.value.totals.callCount === 0;
});

// The header names the scope of the active view so a panel titled
// "Rancher usage · 30d" can't be misread while the Total view shows
// workspace-wide numbers.
const viewHint = computed(() =>
  view.value === 'agent' ? 'this agent only' : 'all agents',
);

// Strip mode: the host page decides where "Details" leads (agent page →
// the Overview tab with the full usage card).
const emit = defineEmits<{ details: [] }>();

const todayTitle = computed(() => {
  const today = agentUsage.value?.today;
  if (!today) return undefined;
  const model = today.model ? ` · ${today.model}` : '';
  return `Today · in ${count.format(today.inputTokens)} / out ${count.format(today.outputTokens)}${model}`;
});

const cost = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 4,
});
const count = new Intl.NumberFormat('en-US');

function shortDate(iso: string): string {
  return iso.slice(5); // YYYY-MM-DD → MM-DD
}

async function refresh() {
  if (view.value === 'agent') {
    await refreshAgent();
  } else {
    await refreshOverview();
  }
}

defineExpose({ refresh });
</script>

<template>
  <!-- Full-width usage strip: one hairline-bounded row under the page
       header. Label–value pairs read left to right; Details jumps to the
       full usage card on the host page. -->
  <div
    v-if="variant === 'strip'"
    v-bind="$attrs"
    class="flex w-full min-w-0 flex-wrap items-center gap-x-5 gap-y-1.5 border-y border-border/70 py-2.5 text-sm"
  >
    <span class="flex shrink-0 items-center gap-3">
      <span class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        Usage · 30d
      </span>
      <span class="h-4 w-px bg-border" aria-hidden="true" />
    </span>

    <span v-if="activePending" class="text-muted-foreground">Loading usage…</span>
    <span v-else-if="activeError" class="text-destructive">Usage unavailable</span>
    <span v-else-if="activeEmpty" class="text-muted-foreground">No usage reported yet</span>

    <template v-else-if="agentUsage">
      <span class="flex items-baseline gap-1.5">
        <span class="text-muted-foreground">Cost</span>
        <span class="font-semibold">{{ formatUsd(agentUsage.totals.costUsd) }}</span>
      </span>
      <span class="flex items-baseline gap-1.5">
        <span class="text-muted-foreground">Calls</span>
        <span class="font-semibold">{{ count.format(agentUsage.totals.callCount) }}</span>
      </span>
      <span class="flex items-baseline gap-1.5">
        <span class="text-muted-foreground">Input</span>
        <span class="font-semibold">{{ formatCount(agentUsage.totals.inputTokens) }}</span>
      </span>
      <span class="flex items-baseline gap-1.5">
        <span class="text-muted-foreground">Output</span>
        <span class="font-semibold">{{ formatCount(agentUsage.totals.outputTokens) }}</span>
      </span>
      <span class="flex items-baseline gap-1.5" :title="todayTitle">
        <span class="text-muted-foreground">Today</span>
        <span class="font-semibold">{{ count.format(agentUsage.today.callCount) }} calls</span>
      </span>
      <span
        v-if="agentUsage.topModel"
        class="flex min-w-0 items-baseline gap-1.5"
        :title="agentUsage.topModel"
      >
        <span class="text-muted-foreground">Model</span>
        <span class="truncate font-semibold">{{ agentUsage.topModel }}</span>
      </span>
    </template>

    <button
      type="button"
      class="ml-auto shrink-0 text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
      @click="emit('details')"
    >
      Details
    </button>
  </div>

  <Button
    v-else-if="collapsible && collapsed"
    variant="outline"
    size="sm"
    class="self-start"
    title="Show usage"
    @click="collapsed = false"
  >
    <IconChartBar class="size-4" />
    Usage
  </Button>

  <Card v-else v-bind="$attrs" class="flex min-h-0 flex-col gap-0 py-4">
    <CardHeader class="flex flex-row items-center justify-between space-y-0 px-4 pb-3">
      <CardTitle class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {{ title }}
        <span class="ml-1 normal-case tracking-normal text-muted-foreground/70">
          · {{ viewHint }}
        </span>
      </CardTitle>
      <div class="flex items-center gap-1">
        <IconActivity class="size-4 text-muted-foreground" />
        <Button
          v-if="collapsible"
          variant="ghost"
          size="sm"
          class="h-7 px-2 text-xs"
          @click="collapsed = true"
        >
          Hide
        </Button>
      </div>
    </CardHeader>

    <CardContent class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4">
      <Tabs
        v-if="!agentOnly"
        :model-value="view"
        @update:model-value="view = $event as UsageView"
      >
        <TabsList class="grid w-full grid-cols-3">
          <TabsTrigger value="total" class="text-xs">Total</TabsTrigger>
          <TabsTrigger value="calls" class="text-xs">Calls</TabsTrigger>
          <TabsTrigger
            value="agent"
            class="text-xs"
            :disabled="!agentId"
            :title="agentId ? undefined : 'No agent deployed yet'"
          >
            Agent
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div v-if="activePending" class="grid grid-cols-2 gap-4">
        <div v-for="i in 6" :key="i" class="space-y-2">
          <Skeleton class="h-3 w-20" />
          <Skeleton class="h-4 w-24" />
        </div>
      </div>

      <p v-else-if="activeError" class="text-sm text-destructive">
        Failed to load usage. Use the page refresh to retry.
      </p>

      <p v-else-if="activeEmpty" class="text-sm text-muted-foreground">
        No usage reported yet.
      </p>

      <template v-else>
        <!-- TOTAL — workspace-wide cost -->
        <template v-if="view === 'total' && overview">
          <div class="flex flex-col">
            <span class="text-xs text-muted-foreground">30d · cost, all agents</span>
            <span class="text-2xl font-semibold tabular-nums">
              {{ cost.format(overview.totals.costUsd) }}
            </span>
          </div>
          <dl class="grid grid-cols-2 gap-x-4 gap-y-2">
            <div>
              <dt class="text-xs text-muted-foreground">30d · in / out</dt>
              <dd class="mt-0.5 font-mono text-sm">
                {{ formatCount(overview.totals.inputTokens) }} /
                {{ formatCount(overview.totals.outputTokens) }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted-foreground">30d · calls</dt>
              <dd class="mt-0.5 font-mono text-sm">{{ count.format(overview.totals.callCount) }}</dd>
            </div>
            <div class="col-span-2">
              <dt class="text-xs text-muted-foreground">30d · top model</dt>
              <dd class="mt-0.5 font-mono text-xs">{{ overview.topModel ?? '—' }}</dd>
            </div>
          </dl>

          <div v-if="byAgentSorted.length" class="flex flex-col gap-1">
            <span class="text-xs text-muted-foreground">By agent</span>
            <div
              v-for="a in byAgentShown"
              :key="a.agentId"
              class="flex items-center justify-between gap-2 text-sm"
            >
              <span class="truncate">{{ a.agentName }}</span>
              <span class="shrink-0 font-mono tabular-nums text-xs">
                {{ cost.format(a.costUsd) }}
              </span>
            </div>
            <Button
              v-if="byAgentSorted.length > BY_AGENT_LIMIT"
              variant="ghost"
              size="sm"
              class="h-7 self-start px-2 text-xs"
              @click="byAgentExpanded = !byAgentExpanded"
            >
              {{ byAgentExpanded ? 'Show less' : `Show all (${byAgentSorted.length})` }}
            </Button>
          </div>
        </template>

        <!-- CALLS — workspace-wide call volume -->
        <template v-else-if="view === 'calls' && overview">
          <div class="flex flex-col">
            <span class="text-xs text-muted-foreground">30d · calls, all agents</span>
            <span class="text-2xl font-semibold tabular-nums">
              {{ count.format(overview.totals.callCount) }}
            </span>
          </div>
          <dl class="grid grid-cols-2 gap-x-4 gap-y-2">
            <div>
              <dt class="text-xs text-muted-foreground">30d · in / out</dt>
              <dd class="mt-0.5 font-mono text-sm">
                {{ formatCount(overview.totals.inputTokens) }} /
                {{ formatCount(overview.totals.outputTokens) }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted-foreground">30d · top model</dt>
              <dd class="mt-0.5 font-mono text-xs">{{ overview.topModel ?? '—' }}</dd>
            </div>
          </dl>
        </template>

        <!-- AGENT — this agent only, full parity with the legacy usage card -->
        <template v-else-if="view === 'agent' && agentUsage">
          <div class="flex flex-col">
            <span class="text-xs text-muted-foreground">30d · cost, this agent</span>
            <span class="text-2xl font-semibold tabular-nums">
              {{ cost.format(agentUsage.totals.costUsd) }}
            </span>
          </div>
          <dl class="grid grid-cols-2 gap-x-4 gap-y-2">
            <div>
              <dt class="text-xs text-muted-foreground">30d · top model</dt>
              <dd class="mt-0.5 font-mono text-xs">{{ agentUsage.topModel ?? '—' }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted-foreground">30d · calls</dt>
              <dd class="mt-0.5 font-mono text-sm">{{ count.format(agentUsage.totals.callCount) }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted-foreground">30d · input</dt>
              <dd class="mt-0.5 font-mono text-sm">{{ count.format(agentUsage.totals.inputTokens) }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted-foreground">30d · output</dt>
              <dd class="mt-0.5 font-mono text-sm">{{ count.format(agentUsage.totals.outputTokens) }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted-foreground">Today · model</dt>
              <dd class="mt-0.5 font-mono text-xs">{{ agentUsage.today.model ?? '—' }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted-foreground">Today · calls</dt>
              <dd class="mt-0.5 font-mono text-sm">{{ count.format(agentUsage.today.callCount) }}</dd>
            </div>
            <div class="col-span-2">
              <dt class="text-xs text-muted-foreground">Today · in / out</dt>
              <dd class="mt-0.5 font-mono text-sm">
                {{ count.format(agentUsage.today.inputTokens) }} /
                {{ count.format(agentUsage.today.outputTokens) }}
              </dd>
            </div>
          </dl>
        </template>

        <!-- Daily breakdown — paginated, newest first (server ordering) -->
        <div v-if="totalRows > 0" class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">Daily</span>
          <table class="w-full text-xs">
            <tbody>
              <tr
                v-for="e in pagedDaily"
                :key="`${e.date}|${e.model}`"
                class="border-b border-border/40 last:border-0"
              >
                <td class="py-1 pr-2 font-mono text-muted-foreground">{{ shortDate(e.date) }}</td>
                <td class="max-w-24 truncate py-1 pr-2 font-mono" :title="e.model">{{ e.model }}</td>
                <td class="py-1 pr-2 text-right font-mono tabular-nums">
                  {{ formatCount(e.inputTokens) }}/{{ formatCount(e.outputTokens) }}
                </td>
                <td class="py-1 text-right font-mono tabular-nums">
                  <template v-if="view === 'calls'">{{ count.format(e.callCount) }}</template>
                  <template v-else>{{ cost.format(e.costUsd) }}</template>
                </td>
              </tr>
            </tbody>
          </table>

          <div
            v-if="totalRows > PAGE_SIZE"
            class="flex items-center justify-between pt-1"
          >
            <Button
              variant="ghost"
              size="sm"
              class="h-7 px-2"
              :disabled="page <= 1"
              @click="page -= 1"
            >
              <IconChevronLeft class="size-4" />
            </Button>
            <span class="text-xs tabular-nums text-muted-foreground">{{ rangeLabel }}</span>
            <Button
              variant="ghost"
              size="sm"
              class="h-7 px-2"
              :disabled="page >= pageCount"
              @click="page += 1"
            >
              <IconChevronRight class="size-4" />
            </Button>
          </div>
        </div>
      </template>
    </CardContent>
  </Card>
</template>
