<script setup lang="ts">
import type {
  AssistantLevel,
  AssistantLevelOrCustom,
} from '#assistantAccess/domain';
import { LEVEL_HINTS, LEVEL_LABELS } from '#assistantAccess/utils/assistantAccess';

/**
 * One choice of level: Basic, Standard or Full, the way an agent's access is
 * one choice of three. A custom pick is no fourth button: nothing is selected
 * and the caption says "Custom · 96 of 157", with the levels one click away
 * to start over from (contracts/ui.md).
 */
const props = defineProps<{
  level: AssistantLevelOrCustom;
  /** The levels worth offering this role; Users get two. */
  levels: readonly AssistantLevel[];
  /** Levels the person editing may not hand out, with why. */
  blocked?: readonly AssistantLevel[];
  blockedReason?: string;
  offered: number;
  available: number;
  disabled?: boolean;
  /** What the group is about, for a screen reader. */
  label: string;
}>();

const emit = defineEmits<{ choose: [level: AssistantLevel] }>();

const isBlocked = (level: AssistantLevel) => props.blocked?.includes(level) ?? false;

function choose(level: AssistantLevel) {
  if (props.disabled || isBlocked(level) || level === props.level) return;
  emit('choose', level);
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
    <div
      role="radiogroup"
      :aria-label="label"
      class="inline-grid shrink-0 gap-0.5 rounded-md border bg-muted p-0.5"
      :style="{ gridTemplateColumns: `repeat(${levels.length}, minmax(0, 1fr))` }"
    >
      <button
        v-for="option in levels"
        :key="option"
        type="button"
        role="radio"
        :aria-checked="level === option"
        :disabled="disabled || isBlocked(option)"
        :title="isBlocked(option) ? blockedReason : LEVEL_HINTS[option]"
        :data-assistant-level="option"
        :data-state="level === option ? 'on' : 'off'"
        class="rounded-[5px] px-3 py-1 text-xs font-medium text-muted-foreground transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs"
        @click="choose(option)"
      >
        {{ LEVEL_LABELS[option] }}
      </button>
    </div>
    <span
      v-if="level === 'custom'"
      class="text-xs text-muted-foreground tabular-nums"
      data-assistant-custom
    >
      Custom · {{ offered }} of {{ available }}
    </span>
  </div>
</template>
