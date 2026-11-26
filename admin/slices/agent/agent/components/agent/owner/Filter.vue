<script setup lang="ts">
import type { OwnerFilterTypes } from '#agent/utils/agentOwnership';
import { formatNumber } from '#common/utils/format';

/**
 * "All / Mine" above the list of agents (CLEAN-259). Drawn by its parent
 * only for somebody who has agents of their own: for everybody else the two
 * would be the same list. Twin of the app console's
 * `components/agent/OwnerFilter.vue`.
 *
 * Two pressed-or-not buttons. Each is 34 px tall in a 42 px control, and its
 * hit area is the whole 42.
 */
defineProps<{
  modelValue: OwnerFilterTypes;
  /** How many agents the list holds, and how many of them are the viewer's. */
  total: number;
  mine: number;
}>();
defineEmits<{ 'update:modelValue': [value: OwnerFilterTypes] }>();

const OPTIONS: readonly OwnerFilterTypes[] = ['all', 'mine'];
</script>

<template>
  <div
    class="agent-owner-filter inline-flex shrink-0 self-start rounded-full border bg-background p-[3px]"
    role="group"
    aria-label="Which agents"
    data-owner-filter
  >
    <button
      v-for="option in OPTIONS"
      :key="option"
      type="button"
      class="agent-owner-filter__seg"
      :aria-pressed="modelValue === option"
      :data-owner-filter-option="option"
      @click="$emit('update:modelValue', option)"
    >
      {{ option === 'mine' ? 'Mine' : 'All' }}
      <span class="agent-owner-filter__count font-mono text-[10.5px]">
        {{ formatNumber(option === 'mine' ? mine : total) }}
      </span>
    </button>
  </div>
</template>

<style scoped>
.agent-owner-filter__seg {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  color: var(--muted-foreground);
  transition:
    background-color 150ms,
    color 150ms;
}
/* The hit area reaches the control's edge, border included: 42 px to tap. */
.agent-owner-filter__seg::after {
  content: '';
  position: absolute;
  inset: -4px 0;
}
.agent-owner-filter__seg:hover {
  color: var(--foreground);
}
.agent-owner-filter__seg[aria-pressed='true'] {
  background: var(--muted);
  color: var(--foreground);
}
.agent-owner-filter__seg:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 1px;
}
.agent-owner-filter__count {
  color: var(--muted-foreground);
}
.agent-owner-filter__seg[aria-pressed='true'] .agent-owner-filter__count {
  color: var(--primary);
}
@media (prefers-reduced-motion: reduce) {
  .agent-owner-filter__seg {
    transition: none;
  }
}
</style>
