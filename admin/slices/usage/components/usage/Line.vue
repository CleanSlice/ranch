<script setup lang="ts">
import {
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger,
} from 'reka-ui';
import { IconChevronDown } from '@tabler/icons-vue';
import { formatCount, formatUsd } from '#agent/utils/agentFormat';
import { usageLineText } from '#usage/utils/usageLine';

/**
 * The agent's usage as one muted line in the workspace header (specs/017,
 * R3): 30-day cost and top model. Clicking it opens the figures the old strip
 * spread across the row, plus the way to the full usage card. Replaces
 * `UsagePanel variant="strip"`.
 *
 * Reads the same per-agent usage the Overview card reads, under the same
 * `useAsyncData` key, so the request is shared rather than doubled.
 */
const props = defineProps<{ agentId: string }>();

const emit = defineEmits<{ details: [] }>();

const usageStore = useUsageStore();

const {
  data: agentUsage,
  pending,
  error,
} = useAsyncData(
  `usage-panel-agent-${props.agentId}`,
  () => usageStore.fetchForAgent(props.agentId),
  { lazy: true },
);

const state = computed<'loading' | 'error' | 'empty' | 'ready'>(() => {
  if (pending.value && !agentUsage.value) return 'loading';
  if (error.value) return 'error';
  if (!agentUsage.value || agentUsage.value.totals.callCount === 0)
    return 'empty';
  return 'ready';
});

const cost = computed(() =>
  agentUsage.value ? `${formatUsd(agentUsage.value.totals.costUsd)} / 30d` : '',
);
const model = computed(() => agentUsage.value?.topModel ?? null);

// The whole line, for the accessible name and the hover title.
const text = computed(() =>
  agentUsage.value
    ? usageLineText(agentUsage.value.totals, agentUsage.value.topModel)
    : '',
);

const count = new Intl.NumberFormat('en-US');

const todayTitle = computed(() => {
  const today = agentUsage.value?.today;
  if (!today) return undefined;
  const m = today.model ? ` · ${today.model}` : '';
  return `Today · in ${count.format(today.inputTokens)} / out ${count.format(today.outputTokens)}${m}`;
});

const open = ref(false);

function onDetails() {
  open.value = false;
  emit('details');
}
</script>

<template>
  <span
    v-if="state === 'loading'"
    class="truncate text-sm text-muted-foreground"
  >
    Loading usage…
  </span>
  <span
    v-else-if="state === 'error'"
    class="truncate text-sm text-destructive"
    title="Usage could not be loaded"
  >
    Usage unavailable
  </span>
  <span
    v-else-if="state === 'empty'"
    class="truncate text-sm text-muted-foreground"
  >
    No usage yet
  </span>

  <PopoverRoot v-else v-model:open="open">
    <PopoverTrigger as-child>
      <button
        type="button"
        class="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        :title="text"
        aria-label="Usage details"
      >
        <!-- The cost never truncates; the model name gives way first. -->
        <span class="shrink-0 font-medium text-foreground">{{ cost }}</span>
        <span v-if="model" class="min-w-0 truncate">· {{ model }}</span>
        <IconChevronDown class="size-3.5 shrink-0" />
      </button>
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent
        align="end"
        :side-offset="6"
        :collision-padding="12"
        class="z-50 w-64 rounded-md border bg-popover p-3 text-sm text-popover-foreground shadow-md outline-none"
      >
        <p class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Usage · 30d · this agent
        </p>
        <dl v-if="agentUsage" class="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt class="text-muted-foreground">Cost</dt>
          <dd class="text-right font-medium tabular-nums">
            {{ formatUsd(agentUsage.totals.costUsd) }}
          </dd>
          <dt class="text-muted-foreground">Calls</dt>
          <dd class="text-right font-medium tabular-nums">
            {{ count.format(agentUsage.totals.callCount) }}
          </dd>
          <dt class="text-muted-foreground">Input</dt>
          <dd class="text-right font-medium tabular-nums">
            {{ formatCount(agentUsage.totals.inputTokens) }}
          </dd>
          <dt class="text-muted-foreground">Output</dt>
          <dd class="text-right font-medium tabular-nums">
            {{ formatCount(agentUsage.totals.outputTokens) }}
          </dd>
          <dt class="text-muted-foreground" :title="todayTitle">Today</dt>
          <dd class="text-right font-medium tabular-nums" :title="todayTitle">
            {{ count.format(agentUsage.today.callCount) }} calls
          </dd>
          <dt v-if="model" class="text-muted-foreground">Model</dt>
          <dd v-if="model" class="truncate text-right font-mono text-xs" :title="model">
            {{ model }}
          </dd>
        </dl>
        <Button
          variant="outline"
          size="sm"
          class="mt-3 w-full"
          @click="onDetails"
        >
          Details
        </Button>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
