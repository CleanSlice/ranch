<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import { Checkbox } from '#theme/components/ui/checkbox';
import { Skeleton } from '#theme/components/ui/skeleton';
import { Badge } from '#theme/components/ui/badge';
import { IconShield } from '@tabler/icons-vue';

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
          :model-value="selected.has(m.id)"
          :disabled="!m.enabled"
          class="mt-0.5"
          @update:model-value="(v: boolean | 'indeterminate') => toggle(m.id, v === true)"
        />
        <label :for="`mcp-${m.id}`" class="flex-1 cursor-pointer">
          <div class="flex items-center gap-2 text-sm font-medium">
            {{ m.name }}
            <Badge v-if="m.builtIn" variant="secondary" class="gap-1 text-xs">
              <IconShield class="size-3" /> Built-in
            </Badge>
            <Badge v-if="!m.enabled" variant="outline" class="text-xs">Disabled</Badge>
          </div>
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
