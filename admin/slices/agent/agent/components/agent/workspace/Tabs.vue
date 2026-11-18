<script setup lang="ts">
import { WORKSPACE_TABS, type WorkspaceTab } from './sections';

// Two tabs, no overflow (specs/017): the sections that used to line up here
// live behind Settings as cards, counts included, so the bar carries nothing
// but the two names.
//
// `tabs` narrows the bar for a viewer who may not manage the agent
// (CLEAN-232): the Ranch admin agent shows an Admin the chat alone.
withDefaults(
  defineProps<{ active: WorkspaceTab; tabs?: readonly WorkspaceTab[] }>(),
  { tabs: () => WORKSPACE_TABS },
);

defineEmits<{
  select: [tab: WorkspaceTab];
  /** Pointer or focus landed on a tab the operator has not chosen yet, which
   *  is the host's cue to fetch what that tab will need (CLEAN-233). */
  prefetch: [tab: WorkspaceTab];
}>();

const TITLES: Record<WorkspaceTab, string> = {
  chat: 'Chat',
  settings: 'Settings',
};
</script>

<template>
  <div class="flex shrink-0 items-center gap-1" role="tablist">
    <button
      v-for="t in tabs"
      :key="t"
      type="button"
      role="tab"
      :aria-selected="active === t"
      :data-workspace-tab="t"
      class="rounded-md px-3 py-1.5 text-sm transition-colors"
      :class="
        active === t
          ? 'bg-muted font-medium text-foreground'
          : 'text-muted-foreground hover:text-foreground'
      "
      @click="$emit('select', t)"
      @mouseenter="$emit('prefetch', t)"
      @focus="$emit('prefetch', t)"
    >
      {{ TITLES[t] }}
    </button>
  </div>
</template>
