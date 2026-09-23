<script setup lang="ts">
import { ShieldAlert, RotateCw } from 'lucide-vue-next'
import type { IAgentToolEntry } from '#toolCatalog/domain'

/**
 * One tool of the panel (CLEAN-109): a button so the keyboard reaches it,
 * a human title first, the technical name in small type, the description in
 * plain words. Click hands the starter template to the composer.
 */
defineProps<{
  tool: IAgentToolEntry
}>()

const emit = defineEmits<{
  pick: [template: string]
}>()
</script>

<template>
  <button
    type="button"
    class="group flex w-full cursor-pointer flex-col gap-1 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    :class="tool.inPod === false ? 'opacity-70' : ''"
    :title="tool.template"
    @click="emit('pick', tool.template)"
  >
    <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span class="text-sm font-medium text-foreground">{{ tool.title }}</span>
      <span class="font-mono text-[11px] text-muted-foreground">{{ tool.name }}</span>
      <span
        v-if="tool.destructive"
        class="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[10px] font-medium text-amber-700 dark:text-amber-300"
        title="The agent asks you to confirm before running this."
      >
        <ShieldAlert class="size-3" />
        asks first
      </span>
      <span
        v-if="tool.inPod === false"
        class="inline-flex items-center gap-1 rounded-full border border-orange-500/40 bg-orange-500/10 px-1.5 py-px text-[10px] font-medium text-orange-700 dark:text-orange-300"
        title="The running agent does not have this tool yet. It will after a restart."
      >
        <RotateCw class="size-3" />
        after restart
      </span>
    </span>
    <span class="text-xs leading-snug text-muted-foreground line-clamp-3">
      {{ tool.description }}
    </span>
  </button>
</template>
