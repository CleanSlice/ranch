<script setup lang="ts">
import { IconX } from '@tabler/icons-vue';
import { basename } from '#agentFile/utils/format';

/**
 * Open-file tabs (CLEAN-112, US5). A dot marks unsaved drafts; closing a
 * dirty tab is the parent's decision (it asks keep/discard).
 */
defineProps<{
  tabs: string[];
  active: string | null;
  dirty: Record<string, boolean>;
}>();

const emit = defineEmits<{
  (e: 'activate', path: string): void;
  (e: 'close', path: string): void;
}>();
</script>

<template>
  <div class="flex min-h-9 items-stretch overflow-x-auto border-b text-xs">
    <div
      v-for="path in tabs"
      :key="path"
      role="tab"
      :aria-selected="active === path"
      class="group flex shrink-0 cursor-pointer items-center gap-1.5 border-r px-3"
      :class="
        active === path
          ? 'bg-background font-medium text-foreground border-b-2 border-b-primary'
          : 'text-muted-foreground hover:bg-accent/60'
      "
      :title="path"
      @click="emit('activate', path)"
      @auxclick.middle.prevent="emit('close', path)"
    >
      <span class="truncate">{{ basename(path) }}</span>
      <span
        v-if="dirty[path]"
        class="size-1.5 rounded-full bg-amber-500"
        title="Unsaved changes"
      />
      <button
        type="button"
        class="rounded p-0.5 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover:opacity-100"
        :class="active === path && 'opacity-100'"
        :aria-label="`Close ${basename(path)}`"
        @click.stop="emit('close', path)"
      >
        <IconX class="size-3" />
      </button>
    </div>
  </div>
</template>
