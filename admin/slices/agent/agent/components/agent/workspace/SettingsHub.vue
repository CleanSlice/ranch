<script setup lang="ts">
import type { ISection, SectionCounts, SectionValue } from './sections';

/**
 * The Settings tab (specs/017, R2): every section as a card. Replaces the
 * eleven-tab bar of specs/006 — the same sections, the same counts, one
 * click further away and no longer permanently on screen.
 */
const props = defineProps<{
  sections: readonly ISection[];
  counts: SectionCounts;
}>();

defineEmits<{ open: [value: SectionValue] }>();

function countFor(section: ISection): number | null {
  if (!section.countKey) return null;
  return props.counts[section.countKey] ?? null;
}
</script>

<template>
  <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
    <AgentWorkspaceSectionCard
      v-for="s in sections"
      :key="s.value"
      :section="s"
      :count="countFor(s)"
      @select="$emit('open', s.value as SectionValue)"
    />
  </div>
</template>
