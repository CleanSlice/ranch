<script setup lang="ts">
import type { IMcpToolSummary } from '#mcpServer/domain';
import TemplateItemToggle from '../item/Toggle.vue';

/**
 * The Tools tab (CLEAN-209): which Documents MCP tools agents of this
 * template list and call. "Every tool" (null) is the default and what every
 * template starts with — Rancher's included; a list limits the pod to those
 * names, which is what a chat agent with one job needs: fewer schemas in
 * every call and the retrieval instructions no longer buried under them.
 *
 * Toggling edits the parent's draft (`v-model:selected`); the "Unsaved
 * changes" bar saves. A pod reads the list when it connects, so running
 * agents see it after a restart.
 */
const selected = defineModel<string[] | null>('selected', { required: true });

const mcpServerStore = useMcpServerStore();
const { pending } = useAsyncData('admin-template-tools-list', () => mcpServerStore.fetchTools(), {
  lazy: true,
});

const limited = computed(() => selected.value !== null);
const selectedSet = computed(() => new Set(selected.value ?? []));

const groups = computed(() => {
  const by = new Map<string, IMcpToolSummary[]>();
  for (const t of mcpServerStore.tools) {
    const key = t.topic ?? 'other';
    if (!by.has(key)) by.set(key, []);
    by.get(key)!.push(t);
  }
  return [...by.entries()].map(([topic, items]) => ({
    topic,
    label: topic.replace(/_/g, ' '),
    items,
    on: items.filter((t) => selectedSet.value.has(t.name)).length,
  }));
});

function setLimited(on: boolean) {
  selected.value = on ? [...selectedSet.value] : null;
}

function toggle(t: IMcpToolSummary) {
  if (!limited.value) return;
  selected.value = selectedSet.value.has(t.name)
    ? (selected.value ?? []).filter((n) => n !== t.name)
    : [...(selected.value ?? []), t.name];
}

function toggleGroup(items: IMcpToolSummary[]) {
  if (!limited.value) return;
  const names = items.map((t) => t.name);
  const allOn = names.every((n) => selectedSet.value.has(n));
  const rest = (selected.value ?? []).filter((n) => !names.includes(n));
  selected.value = allOn ? rest : [...rest, ...names];
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="overflow-hidden rounded-[14px] border bg-card">
      <button
        type="button"
        role="switch"
        :aria-checked="!limited"
        class="flex w-full items-center gap-3.5 border-b px-[18px] py-3.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:bg-muted/40"
        @click="setLimited(false)"
      >
        <span class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="text-sm font-semibold">Every tool</span>
          <span class="text-[13px] leading-snug text-muted-foreground text-pretty">
            The default. Agents of this template list and call every tool the Documents server offers.
          </span>
        </span>
        <TemplateItemToggle :on="!limited" :locked="false" />
      </button>
      <button
        type="button"
        role="switch"
        :aria-checked="limited"
        class="flex w-full items-center gap-3.5 px-[18px] py-3.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:bg-muted/40"
        @click="setLimited(true)"
      >
        <span class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="text-sm font-semibold">Only the tools below</span>
          <span class="text-[13px] leading-snug text-muted-foreground text-pretty">
            Fewer schemas in every call, and the instructions that matter stay in view. A chat agent with one job needs a handful.
          </span>
        </span>
        <TemplateItemToggle :on="limited" :locked="false" />
      </button>
    </div>

    <div v-if="pending && !mcpServerStore.tools.length" class="flex flex-col gap-2.5">
      <Skeleton v-for="i in 3" :key="i" class="h-16 rounded-xl" />
    </div>
    <div
      v-else-if="!mcpServerStore.tools.length"
      class="rounded-[14px] border border-dashed p-10 text-sm text-muted-foreground"
    >
      The Documents server reported no tools.
    </div>
    <template v-else>
      <div
        v-for="g in groups"
        :key="g.topic"
        class="flex flex-col gap-2.5"
        :class="!limited && 'opacity-60'"
      >
        <div class="flex items-baseline gap-2">
          <h3 class="text-[13px] font-semibold capitalize">{{ g.label }}</h3>
          <span class="text-[12.5px] text-muted-foreground/70">
            {{ limited ? `${g.on} of ${g.items.length}` : `${g.items.length}` }}
          </span>
          <button
            v-if="limited"
            type="button"
            class="ml-auto text-[12.5px] text-primary hover:underline"
            @click="toggleGroup(g.items)"
          >
            {{ g.on === g.items.length ? 'None' : 'All' }}
          </button>
        </div>
        <div class="overflow-hidden rounded-[14px] border bg-card">
          <button
            v-for="t in g.items"
            :key="t.name"
            type="button"
            role="switch"
            :aria-checked="!limited || selectedSet.has(t.name)"
            :aria-disabled="!limited"
            class="flex w-full items-center gap-3.5 border-b px-[18px] py-3 text-left transition-colors last:border-b-0 focus-visible:outline-none focus-visible:bg-muted/40"
            :class="limited ? 'hover:bg-muted/40' : 'cursor-default'"
            @click="toggle(t)"
          >
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="flex items-center gap-2 text-sm font-semibold">
                {{ t.title ?? t.name }}
                <code class="font-mono text-[11.5px] font-normal text-muted-foreground/70">{{ t.name }}</code>
              </span>
              <span v-if="t.description" class="line-clamp-2 text-[13px] leading-snug text-muted-foreground text-pretty">
                {{ t.description }}
              </span>
            </span>
            <TemplateItemToggle :on="!limited || selectedSet.has(t.name)" :locked="!limited" />
          </button>
        </div>
      </div>
      <div class="text-[13px] text-muted-foreground">
        A pod reads the list when it connects: running agents of this template see a change after a restart.
      </div>
    </template>
  </div>
</template>
