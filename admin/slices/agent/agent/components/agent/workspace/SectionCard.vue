<script setup lang="ts">
import type { ISection } from './sections';

/**
 * One card of the Settings hub (specs/017, R2): icon tile, name, one-line
 * description and — for the countable sections — how much it holds. `null`
 * renders a muted placeholder, never `0`: "none attached" is real information
 * and must not read as "unknown".
 */
defineProps<{
  section: ISection;
  count: number | null;
}>();

defineEmits<{ select: [] }>();
</script>

<template>
  <button
    type="button"
    class="flex w-full items-start gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    @click="$emit('select')"
  >
    <span
      class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-primary/20 to-primary/5 text-primary"
    >
      <component :is="section.icon" class="size-4.5" />
    </span>
    <span class="min-w-0 flex-1">
      <span class="flex items-center gap-2">
        <span class="truncate text-sm font-medium">{{ section.title }}</span>
        <span
          v-if="section.countKey"
          class="shrink-0 rounded bg-muted px-1.5 text-xs tabular-nums text-muted-foreground"
          :title="count === null ? 'Not known yet' : undefined"
        >
          {{ count === null ? '…' : count }}
        </span>
      </span>
      <span class="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
        {{ section.desc }}
      </span>
    </span>
  </button>
</template>
