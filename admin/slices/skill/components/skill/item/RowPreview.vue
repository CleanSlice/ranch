<script setup lang="ts">
import type { SkillGroup } from '#skill/domain';
import { groupMeta } from '#skill/domain/skill.groups';
import { formatTokens } from '#skill/utils/formatTokens';

/**
 * "How the list shows it": the row the Skills page will draw for what the
 * form holds right now (CLEAN-205). Same clamp, same chip, same meta line.
 */
const props = defineProps<{
  title: string;
  name: string;
  description: string;
  group: SkillGroup | null;
  tokens: number;
  /** Edit mode shows the real template names; create shows "not in any template". */
  templates?: { id: string; name: string }[];
  saved: boolean;
}>();

const meta = computed(() => groupMeta(props.group));
const templatesText = computed(() => {
  const list = props.templates ?? [];
  if (list.length === 0) return 'not in any template';
  if (list.length === 1) return list[0]!.name;
  return `${list.length} templates`;
});
</script>

<template>
  <div data-skill-preview="row" class="rounded-lg border bg-card">
    <div class="flex gap-3 px-3 py-3">
      <span class="w-[3px] shrink-0 self-stretch rounded-full" :class="meta.mark" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-baseline gap-x-2">
          <span class="font-semibold leading-snug">{{ title || 'Untitled skill' }}</span>
          <code class="text-xs text-muted-foreground [overflow-wrap:anywhere]">{{ name || 'slug' }}</code>
        </div>
        <p v-if="description" class="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{{ description }}</p>
        <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span class="rounded px-1.5 py-0.5 font-medium" :class="meta.chip">{{ meta.label }}</span>
          <span class="tabular-nums">≈ {{ formatTokens(tokens) }} tokens</span>
          <span>{{ templatesText }}</span>
          <span v-if="!saved">not saved yet</span>
        </div>
      </div>
    </div>
  </div>
</template>
