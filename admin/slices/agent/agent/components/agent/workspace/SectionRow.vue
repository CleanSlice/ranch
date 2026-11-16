<script setup lang="ts">
import type { ISection } from './sections';

/**
 * One row of the Settings list (specs/031-agent-overview-redesign, R1): icon,
 * name and — for the countable sections — how much it holds, on one line.
 * The description is the tooltip; it is still the only place that says what
 * "A2A" is.
 *
 * A count that is not known yet (or whose source failed) renders nothing at
 * all, never `0`: "none attached" is real information and must not read as
 * "unknown".
 *
 * `active` marks the section whose content is on screen beside the list. It
 * shows as weight and an inset marker on the left as well as the background,
 * so it does not depend on telling two greys apart.
 */
defineProps<{
  section: ISection;
  count: number | null;
  active?: boolean;
}>();

defineEmits<{ select: [] }>();
</script>

<template>
  <button
    type="button"
    role="tab"
    :data-section="section.value"
    :aria-selected="active ? 'true' : 'false'"
    :aria-current="active ? 'page' : undefined"
    :title="section.desc"
    class="flex h-[34px] items-center gap-2 whitespace-nowrap rounded-md px-2.5 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    :class="
      active
        ? 'bg-muted font-semibold shadow-[inset_2px_0_0_var(--primary)]'
        : 'hover:bg-muted'
    "
    @click="$emit('select')"
  >
    <component :is="section.icon" class="size-4 shrink-0" />
    <span class="min-w-0 truncate">{{ section.title }}</span>
    <span
      v-if="count !== null"
      data-section-count
      class="ml-auto shrink-0 pl-1 text-xs font-normal tabular-nums text-muted-foreground"
      >{{ count }}</span
    >
  </button>
</template>
