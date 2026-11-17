<script setup lang="ts">
import { IconAlertTriangle, IconChevronRight, IconLoader2 } from '@tabler/icons-vue';
import type { AgentLogLevel } from '#agent/utils/logLines';
import { formatNumber } from '#common/utils/format';

/**
 * The collapsed Logs bar: one row with the newest line and the entry count.
 * Owns a `useAgentLogSummary` (and its 5 s poll) only while mounted — the
 * parent swaps it for the full panel with `v-if`, never alongside it.
 *
 * The summary is the api's (CLEAN-233): collapsed, this row costs a few
 * hundred bytes a poll rather than the ~100 kB window it used to pull in to
 * find one line and count it in the browser.
 */
const props = defineProps<{
  agentId: string;
  restarting: boolean;
  firstStart: boolean;
}>();

defineEmits<{ expand: [] }>();

const {
  latest,
  total,
  alerts,
  statusLabel,
  error,
  containerWaitingLabel,
} = useAgentLogSummary(props.agentId);

// Same precedence the full panel uses, so the bar never says less than the
// panel would: restart overlay, container waiting, backend marker, error,
// empty, then the line itself.
const state = computed<
  | { kind: 'busy'; text: string }
  | { kind: 'note'; text: string }
  | { kind: 'line' }
>(() => {
  if (props.restarting)
    return {
      kind: 'busy',
      text: props.firstStart ? 'Setting up agent…' : 'Agent is restarting…',
    };
  if (containerWaitingLabel.value)
    return { kind: 'busy', text: `${containerWaitingLabel.value}…` };
  if (statusLabel.value) return { kind: 'note', text: statusLabel.value };
  if (error.value) return { kind: 'note', text: 'Logs unavailable' };
  if (!latest.value) return { kind: 'note', text: 'No entries yet' };
  return { kind: 'line' };
});

const LEVEL_TEXT: Record<AgentLogLevel, string> = {
  error: 'text-red-700 dark:text-red-300',
  warn: 'text-amber-700 dark:text-amber-300',
};
</script>

<template>
  <button
    type="button"
    class="flex w-full min-w-0 items-center gap-2 rounded-md border px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted/60"
    aria-expanded="false"
    title="Show pod logs"
    @click="$emit('expand')"
  >
    <IconChevronRight class="size-3.5 shrink-0 text-muted-foreground" />
    <span class="shrink-0 font-medium">Logs</span>

    <span
      v-if="state.kind === 'busy'"
      class="flex min-w-0 items-center gap-1.5 text-muted-foreground"
    >
      <IconLoader2 class="size-3.5 shrink-0 animate-spin text-primary" />
      <span class="truncate">{{ state.text }}</span>
    </span>
    <span
      v-else-if="state.kind === 'note'"
      class="min-w-0 truncate italic text-muted-foreground"
    >
      {{ state.text }}
    </span>
    <span v-else class="flex min-w-0 items-baseline gap-2 font-mono">
      <span
        v-if="latest?.time"
        class="shrink-0 tabular-nums text-muted-foreground/70"
      >{{ latest.time }}</span>
      <span
        class="min-w-0 truncate"
        :class="latest?.level ? LEVEL_TEXT[latest.level] : ''"
      >{{ latest?.text }}</span>
    </span>

    <span class="ml-auto flex shrink-0 items-center gap-1.5 text-muted-foreground">
      <span class="tabular-nums">{{ formatNumber(total) }} entries</span>
      <span
        v-if="alerts > 0"
        class="flex items-center gap-0.5 text-amber-700 dark:text-amber-300"
        :title="`${alerts} warnings or errors`"
      >
        · {{ formatNumber(alerts) }}
        <IconAlertTriangle class="size-3.5" />
      </span>
    </span>
  </button>
</template>
