<script setup lang="ts">
import { IconChevronRight } from '@tabler/icons-vue';
import type { IAgentSettingsSection } from './sections';

defineProps<{
  section: IAgentSettingsSection;
  /** null = unknown or still loading. Renders nothing — `0` is a real value
   *  meaning "none attached" and must stay distinguishable from it. */
  count: number | null;
  /** This section is what the canvas is currently showing. */
  current: boolean;
}>();

defineEmits<{ select: [] }>();
</script>

<template>
  <!-- A row, not a container. Section content renders in the workspace canvas
       at the width it already has; putting it in here would mean redesigning
       Files, Environment and Paddock for a 320px column (see research R2). -->
  <button
    type="button"
    class="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted"
    :class="current && 'bg-muted'"
    :aria-current="current ? 'true' : undefined"
    @click="$emit('select')"
  >
    <span class="min-w-0 flex-1">
      <span class="block truncate text-sm font-medium">
        {{ section.title }}
      </span>
      <span class="mt-0.5 block truncate text-xs text-muted-foreground">
        {{ section.desc }}
      </span>
    </span>

    <span
      v-if="count !== null"
      class="shrink-0 text-xs tabular-nums text-muted-foreground"
    >
      {{ count }}
    </span>

    <IconChevronRight class="size-4 shrink-0 text-muted-foreground/50" />
  </button>
</template>
