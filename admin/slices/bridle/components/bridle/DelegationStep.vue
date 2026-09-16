<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core';
import type { IBridleThinkingStep } from '#bridle/stores/bridle';

/**
 * A delegation, drawn inside the thinking timeline (CLEAN-74, User Story 4).
 *
 * What this earns over the generic step row: the peer's name, the card skills
 * that made it the choice, the agent's own reason, the task as the peer
 * received it, and a clock that runs while the answer is awaited. The reason
 * line is the one an operator reads to judge whether the cards are written
 * well — "why did it ask that agent" has no other answer anywhere.
 */
const props = defineProps<{ step: IBridleThinkingStep }>();

const delegation = computed(() => props.step.delegation!);
const waiting = computed(() => delegation.value.status === 'waiting');

// Re-rendered four times a second while waiting, and never afterwards: a
// frozen number would read as a stalled chat, which is exactly the "dead air"
// this timeline exists to remove.
const now = ref(Date.now());
const { pause, resume } = useIntervalFn(() => {
  now.value = Date.now();
}, 250, { immediate: false });

watch(
  waiting,
  (isWaiting) => {
    if (isWaiting) resume();
    else pause();
  },
  { immediate: true },
);

onUnmounted(() => pause());

const elapsed = computed(() => {
  const ms = waiting.value
    ? Math.max(0, now.value - delegation.value.startedAt)
    : (delegation.value.durationMs ?? 0);
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
});

const statusClass = computed(() => {
  switch (delegation.value.status) {
    case 'answered':
      return 'text-emerald-600 dark:text-emerald-500';
    case 'failed':
    case 'rejected':
      return 'text-destructive';
    default:
      return 'text-amber-600 dark:text-amber-500';
  }
});

const statusLabel = computed(() => {
  switch (delegation.value.status) {
    case 'answered':
      return 'answered';
    case 'failed':
      return 'could not answer';
    case 'rejected':
      return 'refused';
    default:
      return 'waiting';
  }
});
</script>

<template>
  <div class="flex flex-col gap-1 py-1 text-[13px]">
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span
        :class="
          waiting
            ? 'shimmer shimmer-duration-1600 font-medium text-foreground'
            : 'font-medium text-foreground'
        "
      >
        {{ step.label }}
      </span>
      <span :class="statusClass">{{ statusLabel }}</span>
      <span class="tabular-nums text-muted-foreground">{{ elapsed }}</span>
    </div>

    <ul
      v-if="delegation.matchedSkills.length"
      class="flex flex-wrap gap-1"
      aria-label="Skills that matched"
    >
      <li
        v-for="skill in delegation.matchedSkills"
        :key="skill.id"
        class="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground"
      >
        {{ skill.name }}
      </li>
    </ul>

    <p class="text-muted-foreground">
      <span class="text-foreground/70">Why:</span> {{ delegation.reason }}
    </p>

    <p class="border-l-2 border-border pl-2 italic text-muted-foreground">
      {{ delegation.task }}
    </p>

    <p v-if="delegation.excerpt" class="text-muted-foreground">
      {{ delegation.excerpt }}
    </p>
  </div>
</template>
