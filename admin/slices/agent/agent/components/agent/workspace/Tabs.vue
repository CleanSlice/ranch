<script setup lang="ts">
import { WORKSPACE_TABS, type WorkspaceTab } from './sections';

// Two tabs, no overflow (specs/017): the sections that used to line up here
// live behind Settings as cards, counts included, so the bar carries nothing
// but the two names.
defineProps<{ active: WorkspaceTab }>();

defineEmits<{ select: [tab: WorkspaceTab] }>();

const TITLES: Record<WorkspaceTab, string> = {
  chat: 'Chat',
  settings: 'Settings',
};
</script>

<template>
  <div class="flex shrink-0 items-center gap-1" role="tablist">
    <button
      v-for="t in WORKSPACE_TABS"
      :key="t"
      type="button"
      role="tab"
      :aria-selected="active === t"
      class="rounded-md px-3 py-1.5 text-sm transition-colors"
      :class="
        active === t
          ? 'bg-muted font-medium text-foreground'
          : 'text-muted-foreground hover:text-foreground'
      "
      @click="$emit('select', t)"
    >
      {{ TITLES[t] }}
    </button>
  </div>
</template>
