<script setup lang="ts">
import { ALWAYS_ON_MCP_IDS, KNOWLEDGE_MCP_ID } from '#mcpServer/domain';
import type { IMcpServerData } from '#mcpServer/stores/mcpServer';
import TemplateTile from '../Tile.vue';
import TemplateItemToggle from '../item/Toggle.vue';

/**
 * The MCP servers tab (CLEAN-130): built-in servers first, then the ones
 * registered on this Ranch, each a row with a switch. Toggling edits the
 * parent's draft (`v-model:selected`); the "Unsaved changes" bar saves.
 *
 * The API's resolver hands CleanSlice and Documents to every agent and
 * Knowledge to any agent with knowledge bases, whatever the template says
 * (CLEAN-119). Those rows are drawn locked, in the state the resolver gives
 * them, and never enter the saved set.
 */
const selected = defineModel<string[]>('selected', { required: true });

const mcpServerStore = useMcpServerStore();

const { pending } = useAsyncData('admin-template-mcps-list', () => mcpServerStore.fetchAll(), {
  lazy: true,
});

const selectedSet = computed(() => new Set(selected.value));

function isAlwaysOn(m: IMcpServerData): boolean {
  return ALWAYS_ON_MCP_IDS.includes(m.id);
}
function isKnowledgeBuiltIn(m: IMcpServerData): boolean {
  return m.id === KNOWLEDGE_MCP_ID;
}
function isLocked(m: IMcpServerData): boolean {
  return isAlwaysOn(m) || isKnowledgeBuiltIn(m) || !m.enabled;
}
/** What the switch shows: the resolver's verdict for locked rows, the draft otherwise. */
function isOn(m: IMcpServerData): boolean {
  if (isAlwaysOn(m)) return m.enabled;
  if (isKnowledgeBuiltIn(m)) return false;
  return selectedSet.value.has(m.id);
}

function lockNote(m: IMcpServerData): string | null {
  if (isAlwaysOn(m)) return 'Every agent gets this server whatever the template says. Turn it off for the whole Ranch on the MCP servers page.';
  if (isKnowledgeBuiltIn(m)) return 'Attached automatically to agents that have a knowledge base; nothing to pick here.';
  if (!m.enabled) return 'Disabled on the MCP servers page; enable it there first.';
  return null;
}

const groups = computed(() => [
  {
    key: 'builtin',
    title: 'Built-in',
    note: 'Hosted by this Ranch',
    items: mcpServerStore.items.filter((m) => m.builtIn),
  },
  {
    key: 'registered',
    title: 'Registered',
    note: 'External servers added to the workspace',
    items: mcpServerStore.items.filter((m) => !m.builtIn),
  },
]);

function toggle(m: IMcpServerData) {
  if (isLocked(m)) return;
  selected.value = selectedSet.value.has(m.id)
    ? selected.value.filter((x) => x !== m.id)
    : [...selected.value, m.id];
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <div v-if="pending && !mcpServerStore.items.length" class="flex flex-col gap-2.5">
      <Skeleton v-for="i in 3" :key="i" class="h-16 rounded-xl" />
    </div>

    <div
      v-else-if="!mcpServerStore.items.length"
      class="rounded-[14px] border border-dashed p-10 text-sm text-muted-foreground"
    >
      No MCP servers yet. Register one in
      <NuxtLink to="/mcps" class="text-primary hover:underline">MCP servers</NuxtLink>.
    </div>

    <template v-else>
      <div v-for="g in groups" :key="g.key" class="flex flex-col gap-2.5">
        <div v-if="g.items.length" class="flex items-baseline gap-2">
          <h3 class="text-[13px] font-semibold">{{ g.title }}</h3>
          <span class="text-[12.5px] text-muted-foreground/70">{{ g.note }}</span>
        </div>
        <div v-if="g.items.length" class="overflow-hidden rounded-[14px] border bg-card">
          <button
            v-for="m in g.items"
            :key="m.id"
            type="button"
            role="switch"
            :aria-checked="isOn(m)"
            :aria-disabled="isLocked(m)"
            class="flex w-full items-center gap-3.5 border-b px-[18px] py-3.5 text-left transition-colors last:border-b-0 focus-visible:outline-none focus-visible:bg-muted/40"
            :class="isLocked(m) ? 'cursor-default' : 'hover:bg-muted/40'"
            @click="toggle(m)"
          >
            <TemplateTile :id="m.id" :name="m.name" size="sm" class="rounded-[9px]" />
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="flex items-center gap-2 text-sm font-semibold">
                {{ m.name }}
                <Badge v-if="isAlwaysOn(m) && m.enabled" variant="outline" class="text-[10.5px]">Always on</Badge>
                <Badge v-else-if="isKnowledgeBuiltIn(m)" variant="outline" class="text-[10.5px]">With knowledge bases</Badge>
                <Badge v-if="!m.enabled" variant="outline" class="text-[10.5px]">Disabled</Badge>
              </span>
              <span v-if="m.description" class="text-[13px] leading-snug text-muted-foreground text-pretty">
                {{ m.description }}
              </span>
              <span v-if="lockNote(m)" class="text-xs text-muted-foreground/80">{{ lockNote(m) }}</span>
              <code class="truncate font-mono text-[11.5px] text-muted-foreground/70">{{ m.url }}</code>
            </span>
            <TemplateItemToggle :on="isOn(m)" :locked="isLocked(m)" />
          </button>
        </div>
      </div>
      <div class="text-[13px] text-muted-foreground">
        Need another server? Register it in
        <NuxtLink to="/mcps" class="text-primary hover:underline">MCP servers</NuxtLink>.
      </div>
    </template>
  </div>
</template>
