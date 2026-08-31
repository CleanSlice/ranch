<script setup lang="ts">
import type { IKnowledge } from '#reins/stores/knowledge';

const props = defineProps<{
  knowledges: IKnowledge[];
  modelValue: string[];
}>();

const emit = defineEmits<{ 'update:modelValue': [string[]] }>();

const search = ref('');

const filtered = computed<IKnowledge[]>(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return props.knowledges;
  return props.knowledges.filter(
    (k) =>
      k.name.toLowerCase().includes(q) ||
      (k.description ?? '').toLowerCase().includes(q),
  );
});

function toggle(id: string, checked: boolean | 'indeterminate'): void {
  const next =
    checked === true
      ? [...new Set([...props.modelValue, id])]
      : props.modelValue.filter((x) => x !== id);
  emit('update:modelValue', next);
}

function formatSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
</script>

<template>
  <div class="grid gap-2">
    <Input
      v-if="knowledges.length > 6"
      v-model="search"
      placeholder="Filter bases by name or description"
    />
    <div class="flex max-h-72 flex-col gap-1 overflow-auto rounded-md border p-2">
      <label
        v-for="k in filtered"
        :key="k.id"
        class="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-muted/50"
      >
        <Checkbox
          :model-value="modelValue.includes(k.id)"
          @update:model-value="(v) => toggle(k.id, v)"
        />
        <div class="grid min-w-0 flex-1 gap-0.5">
          <div class="flex items-center gap-2">
            <span class="truncate text-sm font-medium">{{ k.name }}</span>
            <KnowledgeIndexStatusBadge :status="k.indexStatus" />
          </div>
          <span v-if="k.description" class="truncate text-xs text-muted-foreground">
            {{ k.description }}
          </span>
          <span class="text-xs text-muted-foreground">
            {{ k.sourcesCount ?? k.sources?.length ?? 0 }}
            {{ (k.sourcesCount ?? 0) === 1 ? 'source' : 'sources' }}
            <template v-if="formatSize(k.totalSizeBytes)">
              · {{ formatSize(k.totalSizeBytes) }}
            </template>
          </span>
        </div>
      </label>
      <p
        v-if="!filtered.length"
        class="p-2 text-center text-xs text-muted-foreground"
      >
        No base matches “{{ search.trim() }}”.
      </p>
    </div>
  </div>
</template>
