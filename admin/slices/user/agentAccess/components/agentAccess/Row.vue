<script setup lang="ts">
import type { AgentStatusTypes } from '#agent/domain';
import { TONE } from '#agent/composables/useAgentRailEntries';
import {
  ACCESS_CHOICES,
  ACCESS_CHOICE_LABELS,
  type AccessChoice,
} from '#agentAccess/utils/outcome';

/**
 * One agent, one choice: Default (no entry), Allowed or Denied. A row cannot
 * say two things, so an agent cannot be put on both lists from this screen.
 * The status is the rail's label and colours, so the same agent reads the
 * same here.
 */
const props = defineProps<{
  agent: { id: string; name: string; status: AgentStatusTypes };
  /** The choice shown: the person's pending one, or what is stored. */
  choice: AccessChoice;
  /** The choice differs from what is stored. */
  changed?: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{ choose: [choice: AccessChoice] }>();

const tone = computed(() => TONE[props.agent.status]);

const SELECTED: Record<AccessChoice, string> = {
  none: 'bg-background text-foreground shadow-xs',
  allowed: 'bg-emerald-600 text-white shadow-xs',
  denied: 'bg-rose-600 text-white shadow-xs',
};

function choose(choice: AccessChoice) {
  if (props.disabled || choice === props.choice) return;
  emit('choose', choice);
}
</script>

<template>
  <div
    class="flex flex-col gap-2 rounded-md px-2 py-2 hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
    :class="changed && 'bg-amber-500/10 hover:bg-amber-500/10'"
    :data-access-row="agent.id"
    :data-access-value="choice"
    :data-access-changed="changed ? '' : undefined"
  >
    <div class="flex min-w-0 items-center gap-2">
      <span class="truncate text-sm font-medium" data-access-name>{{ agent.name }}</span>
      <span class="flex shrink-0 items-center gap-1.5 text-xs" :class="tone?.text">
        <span class="inline-flex size-2 rounded-full" :class="tone?.dot" />
        <span class="capitalize" data-access-status>{{ agent.status }}</span>
      </span>
    </div>
    <div
      role="radiogroup"
      :aria-label="`Access to ${agent.name}`"
      class="grid w-full shrink-0 grid-cols-3 gap-0.5 rounded-md border bg-muted p-0.5 sm:w-auto"
    >
      <button
        v-for="option in ACCESS_CHOICES"
        :key="option"
        type="button"
        role="radio"
        :aria-checked="choice === option"
        :disabled="disabled"
        :data-access-choice="option"
        :data-state="choice === option ? 'on' : 'off'"
        class="rounded-[5px] px-3 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
        :class="choice === option ? SELECTED[option] : 'text-muted-foreground hover:text-foreground'"
        @click="choose(option)"
      >
        {{ ACCESS_CHOICE_LABELS[option] }}
      </button>
    </div>
  </div>
</template>
