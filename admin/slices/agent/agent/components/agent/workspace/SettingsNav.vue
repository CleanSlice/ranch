<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core';
import {
  SECTION_GROUPS,
  type ISection,
  type SectionCounts,
  type SectionValue,
} from './sections';

/**
 * The Settings list (specs/031-agent-overview-redesign, R1): every section as
 * a one-line row, stacked beside the open section's content under three small
 * headings, Overview alone on top. Picking a row swaps the content in place —
 * nothing to fall into and climb back out of.
 *
 * Below `xl` there is no room for a column next to the content, so the same
 * rows become one horizontally scrolling row above it, without the headings.
 */
const props = defineProps<{
  sections: readonly ISection[];
  counts: SectionCounts;
  active: SectionValue;
}>();

defineEmits<{ select: [value: SectionValue] }>();

// Tailwind's `xl`. The classes below lay the list out; this says the same
// thing to assistive technology and to the arrow keys, and takes the headings
// out of the one-row layout altogether. Not `lg`: at 1024 px the admin
// sidebar and the agent list are still on screen, and a column here as well
// left the open section some 230 px.
const vertical = useMediaQuery('(min-width: 1280px)', { ssrWidth: 1280 });

const nav = ref<HTMLElement | null>(null);

function countFor(section: ISection): number | null {
  if (!section.countKey) return null;
  return props.counts[section.countKey] ?? null;
}

/** The heading a row opens: set on the first row of each group only. */
function headingAt(index: number) {
  const group = props.sections[index]!.group;
  if (group === null) return null;
  if (index > 0 && props.sections[index - 1]!.group === group) return null;
  for (let i = 0; i < SECTION_GROUPS.length; i += 1) {
    if (SECTION_GROUPS[i]!.value === group) return SECTION_GROUPS[i]!;
  }
  return null;
}

/**
 * Arrow keys walk the rows along the axis the list is laid out on, Home and
 * End jump to the ends. Focus only: a row opens on Enter or Space, as any
 * button does, so walking the list does not remount a section per keypress.
 */
function onKeydown(event: KeyboardEvent) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const rows = nav.value?.querySelectorAll<HTMLElement>('[role="tab"]');
  if (!rows || rows.length === 0) return;

  let current = -1;
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i] === document.activeElement) current = i;
  }
  if (current === -1) return;

  const next = vertical.value ? 'ArrowDown' : 'ArrowRight';
  const prev = vertical.value ? 'ArrowUp' : 'ArrowLeft';
  let target = current;
  if (event.key === next) target = (current + 1) % rows.length;
  else if (event.key === prev) target = (current - 1 + rows.length) % rows.length;
  else if (event.key === 'Home') target = 0;
  else if (event.key === 'End') target = rows.length - 1;
  else return;

  event.preventDefault();
  rows[target]!.focus();
}
</script>

<template>
  <nav
    ref="nav"
    data-section-nav
    role="tablist"
    aria-label="Agent settings"
    :aria-orientation="vertical ? 'vertical' : 'horizontal'"
    class="flex shrink-0 gap-px overflow-x-auto pb-1 xl:max-h-full xl:w-48 xl:flex-col xl:self-start xl:overflow-x-visible xl:overflow-y-auto xl:pb-0"
    @keydown="onKeydown"
  >
    <template v-for="(s, i) in sections" :key="s.value">
      <div
        v-if="vertical && headingAt(i)"
        role="presentation"
        :data-section-group="headingAt(i)!.value"
        class="px-2.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase leading-4 tracking-wide text-muted-foreground"
      >
        {{ headingAt(i)!.title }}
      </div>
      <AgentWorkspaceSectionRow
        :section="s"
        :count="countFor(s)"
        :active="s.value === active"
        class="shrink-0"
        @select="$emit('select', s.value as SectionValue)"
      />
    </template>
  </nav>
</template>
