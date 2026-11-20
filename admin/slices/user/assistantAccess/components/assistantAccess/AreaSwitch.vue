<script setup lang="ts">
import type { AreaSwitchState } from '#assistantAccess/utils/assistantAccess';

/**
 * The switch of one area in the Advanced panel. Three states, because an
 * area with some abilities unticked is neither on nor off; a checkbox role
 * is the one that can say "mixed" to a screen reader. Clicking partly-on
 * turns the area on.
 */
const props = defineProps<{
  state: AreaSwitchState;
  label: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{ toggle: [] }>();

const TRACK: Record<AreaSwitchState, string> = {
  on: 'bg-primary',
  mixed: 'bg-primary/50',
  off: 'bg-input',
};
const THUMB: Record<AreaSwitchState, string> = {
  on: 'translate-x-[calc(100%-2px)]',
  mixed: 'translate-x-[calc(50%-1px)]',
  off: 'translate-x-0',
};

function toggle() {
  if (!props.disabled) emit('toggle');
}
</script>

<template>
  <button
    type="button"
    role="checkbox"
    :aria-checked="state === 'mixed' ? 'mixed' : state === 'on'"
    :aria-label="label"
    :disabled="disabled"
    :data-area-state="state"
    class="inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
    :class="TRACK[state]"
    @click.stop="toggle"
    @keydown.space.prevent.stop="toggle"
  >
    <span
      class="pointer-events-none block size-4 rounded-full bg-background transition-transform"
      :class="THUMB[state]"
    />
  </button>
</template>
