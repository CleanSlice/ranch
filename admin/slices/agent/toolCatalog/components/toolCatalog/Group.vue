<script setup lang="ts">
import { Loader2, RotateCw } from 'lucide-vue-next'
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '#theme/components/ui/accordion'
import type { IAgentToolGroup } from '#toolCatalog/domain'
import Row from './Row.vue'

/**
 * One accordion of the panel: a topic of built-in tools, or an external MCP
 * server the agent is attached to (whose tools the server itself provides).
 * "After restart" on the header means the running pod lacks at least one
 * tool here; the restart button reuses the agent store's normal flow.
 */
defineProps<{
  group: IAgentToolGroup
  restarting: boolean
  canRestart: boolean
}>()

const emit = defineEmits<{
  pick: [template: string]
  restart: []
}>()
</script>

<template>
  <AccordionItem :value="group.key">
    <AccordionTrigger class="py-2.5">
      <span class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <span class="truncate">{{ group.title }}</span>
        <span
          v-if="group.kind === 'builtin'"
          class="rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground"
        >
          {{ group.tools.length }}
        </span>
        <span
          v-else
          class="rounded-full bg-muted px-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
        >
          MCP server
        </span>
        <span
          v-if="group.afterRestart"
          class="inline-flex items-center gap-1 rounded-full border border-orange-500/40 bg-orange-500/10 px-1.5 py-px text-[10px] font-medium text-orange-700 dark:text-orange-300"
        >
          <RotateCw class="size-3" />
          after restart
        </span>
      </span>
    </AccordionTrigger>
    <AccordionContent class="pb-2">
      <div
        v-if="group.afterRestart"
        class="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-orange-500/40 bg-orange-500/10 px-2.5 py-2 text-xs text-orange-700 dark:text-orange-300"
      >
        <span>
          {{
            group.kind === 'builtin'
              ? 'The running agent does not have the marked tools yet. You can still insert a prompt, but the agent cannot act on it until it restarts.'
              : 'This server changed after the agent started. The agent connects to it after a restart.'
          }}
        </span>
        <button
          type="button"
          :disabled="restarting || !canRestart"
          class="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-orange-500/50 bg-background px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          @click="emit('restart')"
        >
          <Loader2 v-if="restarting" class="size-3 animate-spin" />
          <RotateCw v-else class="size-3" />
          {{ restarting ? 'Restarting…' : 'Restart now' }}
        </button>
      </div>

      <div v-if="group.kind === 'external'" class="px-2 text-xs text-muted-foreground">
        <p v-if="group.description">{{ group.description }}</p>
        <p class="mt-1">
          Its tools are provided by the server itself; ask the agent what it can do
          with it, or open the server on the MCP servers page.
        </p>
      </div>
      <div v-else class="flex flex-col">
        <Row
          v-for="tool in group.tools"
          :key="tool.name"
          :tool="tool"
          @pick="emit('pick', $event)"
        />
      </div>
    </AccordionContent>
  </AccordionItem>
</template>
