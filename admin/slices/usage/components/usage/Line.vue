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
import { formatNumber } from '#common/utils/format';

/**
 * The agent's usage as one muted line in the workspace header (specs/017,
 * R3): 30-day cost and the model the agent is running. Clicking it opens the
 * figures the old strip spread across the row, plus the way to the full usage
 * card. Replaces `UsagePanel variant="strip"`.
 *
 * The name beside the cost is the *current* model, read from the agent's LLM
 * credential. It used to be `topModel` — the biggest spender of the last
 * thirty days — so an agent switched to a new model kept announcing the old
 * one for a month (CLEAN-149). The header answers "what is this running now";
 * the 30-day top model moved into the popover, beside the figures that share
 * its window.
 *
 * Reads the same per-agent usage the Overview card reads, and loads
 * credentials under the same `useAsyncData` key the Overview LLM card uses, so
 * neither request is doubled.
 */
const props = defineProps<{
  agentId: string;
  llmCredentialId: string | null;
}>();

const emit = defineEmits<{ details: [] }>();

const usageStore = useUsageStore();
const llmStore = useLlmStore();

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

// Same key as the Overview LLM card: one request serves both.
useAsyncData('admin-llms-for-agent', () => llmStore.fetchAll(), {
  lazy: true,
});

const cost = computed(() =>
  agentUsage.value ? `${formatUsd(agentUsage.value.totals.costUsd)} / 30d` : '',
);

/**
 * What the agent is configured to run. Null while the credentials are still
 * loading and null when none is assigned — in both cases the line shows the
 * cost alone rather than filling the gap with the 30-day top model, which
 * would be the very confusion this replaced.
 */
const currentModel = computed(
  () =>
    (props.llmCredentialId
      ? llmStore.items.find((c) => c.id === props.llmCredentialId)?.model
      : null) ?? null,
);

/** The biggest spender of the last 30 days. Popover only. */
const topModel = computed(() => agentUsage.value?.topModel ?? null);

// The whole line, for the accessible name and the hover title.
const text = computed(() =>
  agentUsage.value
    ? usageLineText(agentUsage.value.totals, currentModel.value)
    : '',
);

const todayTitle = computed(() => {
  const today = agentUsage.value?.today;
  if (!today) return undefined;
  const m = today.model ? ` · ${today.model}` : '';
  return `Today · in ${formatNumber(today.inputTokens)} / out ${formatNumber(today.outputTokens)}${m}`;
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
        <span v-if="currentModel" class="min-w-0 truncate">
          · {{ currentModel }}
        </span>
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
        <!-- What the header claims, spelled out and kept away from the 30-day
             figures so the two models can never be read as one. -->
        <div class="mb-3 border-b pb-3">
          <p class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Current model
          </p>
          <p
            v-if="currentModel"
            class="mt-1 truncate font-mono text-xs"
            :title="currentModel"
          >
            {{ currentModel }}
          </p>
          <p v-else class="mt-1 text-xs text-muted-foreground">
            {{
              llmCredentialId
                ? 'Loading…'
                : 'No LLM credential assigned'
            }}
          </p>
        </div>

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
            {{ formatNumber(agentUsage.totals.callCount) }}
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
            {{ formatNumber(agentUsage.today.callCount) }} calls
          </dd>
          <!-- Inside the 30-day block on purpose: this is the biggest
               spender of that window, not what the agent runs today. -->
          <dt v-if="topModel" class="text-muted-foreground">Top model</dt>
          <dd
            v-if="topModel"
            class="truncate text-right font-mono text-xs"
            :title="topModel"
          >
            {{ topModel }}
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
