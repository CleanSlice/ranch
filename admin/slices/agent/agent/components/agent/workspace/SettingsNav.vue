<script setup lang="ts">
import type { ISection, SectionCounts, SectionValue } from './sections';

/**
 * The Settings list (specs/017, R2): every section as a card, stacked
 * vertically beside the open section's content. Picking a card swaps the
 * content in place — nothing to fall into and climb back out of.
 *
 * Below `lg` there is no room for a column next to the content, so the same
 * cards become one horizontally scrolling row above it.
 */
const props = defineProps<{
  sections: readonly ISection[];
  counts: SectionCounts;
  active: SectionValue;
}>();

defineEmits<{ select: [value: SectionValue] }>();

function countFor(section: ISection): number | null {
  if (!section.countKey) return null;
  return props.counts[section.countKey] ?? null;
}
</script>

<template>
  <nav
    role="tablist"
    aria-label="Agent settings"
    aria-orientation="vertical"
    class="flex shrink-0 gap-1.5 overflow-x-auto pb-1 lg:w-64 lg:flex-col lg:overflow-x-visible lg:overflow-y-auto lg:pb-0 lg:pr-1"
  >
    <AgentWorkspaceSectionCard
      v-for="s in sections"
      :key="s.value"
      :section="s"
      :count="countFor(s)"
      :active="s.value === active"
      class="w-56 shrink-0 lg:w-full"
      @select="$emit('select', s.value as SectionValue)"
    />
  </nav>
</template>
