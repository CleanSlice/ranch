<script setup lang="ts">
import AgentFileEditor from './Editor.vue';

const props = defineProps<{
  path: string | null;
  content: string;
  loading: boolean;
  saving: boolean;
  loadError: string | null;
  saveError: string | null;
  dirty: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:content', v: string): void;
  (e: 'save'): void;
}>();

const editable = computed(() => {
  if (!props.path) return false;
  return props.path.endsWith('.md') || props.path.endsWith('.json');
});
</script>

<template>
  <div class="flex h-full flex-col">
    <div
      v-if="!path"
      class="flex flex-1 items-center justify-center rounded-md border border-dashed p-10 text-sm text-muted-foreground"
    >
      Select a file to view
    </div>

    <template v-else>
      <div class="mb-3 flex items-center justify-between gap-2">
        <p class="truncate font-mono text-sm" :title="path">{{ path }}</p>
      </div>

      <div
        v-if="loadError"
        class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
      >
        {{ loadError }}
      </div>
      <div
        v-else-if="loading"
        class="rounded-md border border-dashed p-10 text-center text-xs text-muted-foreground"
      >
        Loading…
      </div>
      <AgentFileEditor
        v-else
        :value="content"
        :saving="saving"
        :error="saveError"
        :read-only="!editable"
        :dirty="dirty"
        class="flex-1"
        @update:value="(v: string) => emit('update:content', v)"
        @save="emit('save')"
      />
    </template>
  </div>
</template>
