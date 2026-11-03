<script setup lang="ts">
import type { ISkillData } from '#skill/domain';
import { groupMeta, SKILL_GROUP_KEYS, SKILL_GROUP_META, UNGROUPED_META } from '#skill/domain/skill.groups';
import { formatTokens } from '#skill/utils/formatTokens';
import { stripSegments } from '#skill/utils/summary';

const props = defineProps<{
  /** In list order — the strip is the list, seen from above. */
  skills: ISkillData[];
  selectedId: string | null;
}>();

const emit = defineEmits<{ select: [slug: string] }>();

const segments = computed(() =>
  stripSegments(props.skills).map((seg, i) => ({
    ...seg,
    meta: groupMeta(props.skills[i]?.group ?? null),
  })),
);

const hasUngrouped = computed(() => props.skills.some((s) => s.group === null));
</script>

<template>
  <div class="flex flex-col gap-2">
    <div
      role="group"
      aria-label="Skills by size, in list order"
      class="flex h-6 w-full gap-px overflow-hidden rounded-md"
    >
      <button
        v-for="seg in segments"
        :key="seg.id"
        type="button"
        :data-skill-segment="seg.slug"
        :aria-label="`${seg.slug}, ${formatTokens(seg.tokens)} tokens`"
        :title="`${seg.slug}, ${formatTokens(seg.tokens)} tokens`"
        :aria-pressed="selectedId === seg.id"
        class="min-w-2 cursor-pointer transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none"
        :class="[seg.meta.strip, selectedId && selectedId !== seg.id ? 'opacity-40' : 'opacity-100']"
        :style="{ flex: `${seg.grow} 1 8px` }"
        @click="emit('select', seg.slug)"
      />
    </div>
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span v-for="key in SKILL_GROUP_KEYS" :key="key" class="inline-flex items-center gap-1.5">
        <span class="size-2.5 rounded-sm" :class="SKILL_GROUP_META[key].strip" aria-hidden="true" />
        {{ SKILL_GROUP_META[key].label }}
      </span>
      <span v-if="hasUngrouped" class="inline-flex items-center gap-1.5">
        <span class="size-2.5 rounded-sm" :class="UNGROUPED_META.strip" aria-hidden="true" />
        {{ UNGROUPED_META.label }}
      </span>
      <span class="ml-auto">Width shows size in tokens</span>
    </div>
  </div>
</template>
