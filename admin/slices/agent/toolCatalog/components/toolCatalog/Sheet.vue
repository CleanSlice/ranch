<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Search, X } from 'lucide-vue-next'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '#theme/components/ui/sheet'
import { Accordion } from '#theme/components/ui/accordion'
import { Input } from '#theme/components/ui/input'
import { ScrollArea } from '#theme/components/ui/scroll-area'
import { useAgentStore } from '#agent/stores/agent'
import { useToolCatalogStore } from '../../stores/toolCatalog'
import { filterCatalog } from '../../utils/filterCatalog'
import Group from './Group.vue'
import Empty from './Empty.vue'

/**
 * The Tools panel (CLEAN-109): what this agent can do, by topic, one click
 * from the composer. Renders the store's record for the agent — never the
 * value a fetch returned — and keeps only loading state from useAsyncData
 * (docs/state.md). Search text and open accordions live in the store per
 * agent so reopening restores them.
 */
const props = defineProps<{
  agentId: string
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  pick: [template: string]
}>()

const store = useToolCatalogStore()
const agentStore = useAgentStore()

const catalog = computed(() => store.byAgent(props.agentId))
const agent = computed(() => agentStore.byId(props.agentId))
const ui = computed(() => store.uiOf(props.agentId))

const { pending, error, refresh } = useAsyncData(
  `admin-tool-catalog-${props.agentId}`,
  () => store.fetchByAgent(props.agentId),
  { immediate: false, server: false },
)

// Load on first open, and again on every open so a tool that landed since is
// there; the cached record renders meanwhile, so nothing flickers.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) void refresh()
  },
  { immediate: true },
)

// After a restart the pod lists again; re-read once the agent is back so the
// "after restart" markers clear without a manual reopen.
watch(
  () => agent.value?.status,
  (status, previous) => {
    if (status === 'running' && previous && previous !== 'running' && props.open) {
      void refresh()
    }
  },
)

const query = computed({
  get: () => ui.value.query,
  set: (value: string) => store.setQuery(props.agentId, value),
})

const groups = computed(() => filterCatalog(catalog.value, query.value))

// While searching, every matching topic is open; otherwise the person's own
// choice. Only an untouched sheet (`expanded === null`) opens the first topic
// so the panel never looks empty — once the person collapses it, `[]` is a
// choice and stays.
const expanded = computed<string[]>({
  get: () => {
    if (query.value.trim()) return groups.value.map((g) => g.key)
    if (ui.value.expanded !== null) return ui.value.expanded
    return groups.value.length ? [groups.value[0].key] : []
  },
  set: (keys: string[]) => {
    if (!query.value.trim()) store.setExpanded(props.agentId, keys)
  },
})

const state = computed<'loading' | 'error' | 'empty' | 'no-results' | 'list'>(() => {
  if (!catalog.value && pending.value) return 'loading'
  if (!catalog.value && error.value) return 'error'
  if (!catalog.value) return 'loading'
  if (!catalog.value.groups.length) return 'empty'
  if (!groups.value.length) return 'no-results'
  return 'list'
})

const errorMessage = computed(() =>
  error.value instanceof Error ? error.value.message : error.value ? String(error.value) : null,
)

const restarting = ref(false)
const canRestart = computed(() => {
  const status = agent.value?.status
  return status === 'running' || status === 'failed' || status === 'unreachable'
})

async function restart() {
  if (restarting.value) return
  restarting.value = true
  try {
    await agentStore.restart(props.agentId)
  } catch {
    // The agent store already rolled the optimistic status back; the panel
    // stays open so the person can try again.
  } finally {
    restarting.value = false
  }
}

function pick(template: string) {
  emit('pick', template)
  emit('update:open', false)
}

const searchRef = ref<InstanceType<typeof Input> | null>(null)
</script>

<template>
  <Sheet :open="open" @update:open="emit('update:open', $event)">
    <SheetContent
      side="right"
      class="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      @open-auto-focus.prevent="searchRef?.$el?.focus?.()"
    >
      <SheetHeader class="gap-1 border-b px-4 pt-4 pb-3 text-left">
        <SheetTitle class="text-base">Tools</SheetTitle>
        <SheetDescription class="text-xs">
          What {{ agent?.name ?? 'this agent' }} can do. Click a tool to drop a
          starter prompt into the chat, then edit it freely.
        </SheetDescription>
        <div class="relative mt-2">
          <Search class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <!-- type="text", not "search": Chromium draws its own clear
               button on search inputs, and the sheet already has one. -->
          <Input
            ref="searchRef"
            v-model="query"
            type="text"
            autocomplete="off"
            placeholder="Search tools…"
            aria-label="Search tools"
            class="h-9 pl-8 pr-8"
          />
          <button
            v-if="query"
            type="button"
            aria-label="Clear search"
            class="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer rounded-sm text-muted-foreground hover:text-foreground"
            @click="query = ''"
          >
            <X class="size-4" />
          </button>
        </div>
      </SheetHeader>

      <ScrollArea class="min-h-0 flex-1">
        <div class="px-4 py-2">
          <Empty
            v-if="state !== 'list'"
            :kind="state"
            :message="errorMessage"
            @retry="refresh()"
            @clear="query = ''"
          />
          <Accordion v-else v-model="expanded" type="multiple" class="w-full">
            <Group
              v-for="group in groups"
              :key="group.key"
              :group="group"
              :restarting="restarting"
              :can-restart="canRestart"
              @pick="pick"
              @restart="restart"
            />
          </Accordion>
        </div>
      </ScrollArea>

      <p
        v-if="catalog?.podStartedAt === null"
        class="border-t px-4 py-2 text-[11px] text-muted-foreground"
      >
        The agent is not running. Tools are listed as they will be once it starts.
      </p>
    </SheetContent>
  </Sheet>
</template>
