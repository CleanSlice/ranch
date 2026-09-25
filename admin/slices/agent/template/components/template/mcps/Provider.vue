<script setup lang="ts">
import { IconShield } from '@tabler/icons-vue';
import { ALWAYS_ON_MCP_IDS, KNOWLEDGE_MCP_ID } from '#mcpServer/domain';
import type { IMcpServerData } from '#mcpServer/stores/mcpServer';

const props = defineProps<{
  templateId: string;
  initialMcpServerIds: string[];
}>();

const emit = defineEmits<{ saved: [mcpServerIds: string[]] }>();

const templateStore = useTemplateStore();
const mcpServerStore = useMcpServerStore();

const { pending: mcpsPending } = useAsyncData(
  'admin-template-mcps-list',
  () => mcpServerStore.fetchAll(),
  { lazy: true },
);

const selected = ref<Set<string>>(new Set(props.initialMcpServerIds));

// The API's resolver hands CleanSlice and Documents to every agent and
// Knowledge to any agent with knowledge bases, whatever the template says
// (CLEAN-119). Drawing them as choices here made the console say "3
// selected" while the pod booted with 5. They are shown locked, in the
// state the resolver gives them, and never enter the saved set.
function isAlwaysOn(m: IMcpServerData): boolean {
  return ALWAYS_ON_MCP_IDS.includes(m.id);
}
function isKnowledgeBuiltIn(m: IMcpServerData): boolean {
  return m.id === KNOWLEDGE_MCP_ID;
}
function isLocked(m: IMcpServerData): boolean {
  return isAlwaysOn(m) || isKnowledgeBuiltIn(m);
}
/** What the checkbox shows: the resolver's verdict for locked rows, the choice otherwise. */
function isChecked(m: IMcpServerData): boolean {
  if (isAlwaysOn(m)) return m.enabled;
  if (isKnowledgeBuiltIn(m)) return false;
  return selected.value.has(m.id);
}
watch(
  () => props.initialMcpServerIds,
  (ids) => (selected.value = new Set(ids)),
);

const dirty = computed(() => {
  if (selected.value.size !== props.initialMcpServerIds.length) return true;
  for (const id of props.initialMcpServerIds) {
    if (!selected.value.has(id)) return true;
  }
  return false;
});

const saving = ref(false);
const error = ref<string | null>(null);

function toggle(id: string, on: boolean) {
  const next = new Set(selected.value);
  if (on) next.add(id);
  else next.delete(id);
  selected.value = next;
}

async function onSave() {
  saving.value = true;
  error.value = null;
  try {
    const ids = [...selected.value];
    await templateStore.setMcps(props.templateId, ids);
    emit('saved', ids);
  } catch (err) {
    const e = err as { message?: string; response?: { data?: { message?: string } } };
    error.value = e?.response?.data?.message ?? e?.message ?? 'Save failed';
  } finally {
    saving.value = false;
  }
}

function onReset() {
  selected.value = new Set(props.initialMcpServerIds);
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div v-if="mcpsPending && mcpServerStore.items.length === 0" class="flex flex-col gap-2">
      <Skeleton v-for="i in 3" :key="i" class="h-14 w-full rounded-md" />
    </div>

    <div
      v-else-if="mcpServerStore.items.length === 0"
      class="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground"
    >
      No MCP servers yet. Register one in
      <NuxtLink to="/mcps" class="underline">MCP servers</NuxtLink>.
    </div>

    <ul v-else class="flex flex-col divide-y rounded-md border">
      <li
        v-for="m in mcpServerStore.items"
        :key="m.id"
        class="flex items-start gap-3 px-3 py-3"
      >
        <Checkbox
          :id="`mcp-${m.id}`"
          :model-value="isChecked(m)"
          :disabled="!m.enabled || isLocked(m)"
          class="mt-0.5"
          @update:model-value="(v: boolean | 'indeterminate') => toggle(m.id, v === true)"
        />
        <label :for="`mcp-${m.id}`" class="flex-1" :class="isLocked(m) ? 'cursor-default' : 'cursor-pointer'">
          <div class="flex items-center gap-2 text-sm font-medium">
            {{ m.name }}
            <Badge v-if="m.builtIn" variant="secondary" class="gap-1 text-xs">
              <IconShield class="size-3" /> Built-in
            </Badge>
            <Badge v-if="isAlwaysOn(m) && m.enabled" variant="outline" class="text-xs">Always on</Badge>
            <Badge v-else-if="isKnowledgeBuiltIn(m)" variant="outline" class="text-xs">With knowledge bases</Badge>
            <Badge v-if="!m.enabled" variant="outline" class="text-xs">Disabled</Badge>
          </div>
          <!-- Not a choice: say where the switch actually is. -->
          <p v-if="isAlwaysOn(m)" class="mt-0.5 text-xs text-muted-foreground">
            Every agent gets this server whatever the template says. Turn it off for the whole Ranch on the
            <NuxtLink :to="`/mcps/${m.id}`" class="underline">MCP servers</NuxtLink> page.
          </p>
          <p v-else-if="isKnowledgeBuiltIn(m)" class="mt-0.5 text-xs text-muted-foreground">
            Attached automatically to agents that have a knowledge base; nothing to pick here.
          </p>
          <p
            v-if="m.description"
            class="mt-0.5 text-xs text-muted-foreground"
          >
            {{ m.description }}
          </p>
          <code class="mt-0.5 block text-xs text-muted-foreground/70">{{ m.url }}</code>
        </label>
      </li>
    </ul>

    <p v-if="error" class="text-xs text-destructive">{{ error }}</p>

    <div class="flex items-center gap-3">
      <Button :disabled="!dirty || saving" @click="onSave">
        {{ saving ? 'Saving…' : 'Save MCPs' }}
      </Button>
      <Button
        type="button"
        variant="ghost"
        :disabled="!dirty || saving"
        @click="onReset"
      >
        Reset
      </Button>
      <span class="text-xs text-muted-foreground">
        {{ selected.size }} selected
      </span>
    </div>
  </div>
</template>
