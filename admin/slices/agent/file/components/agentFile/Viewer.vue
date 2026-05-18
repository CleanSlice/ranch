<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import { IconChevronDown } from '@tabler/icons-vue';
import AgentFileEditor from './Editor.vue';

const props = defineProps<{
  path: string | null;
  content: string;
  loading: boolean;
  saving: boolean;
  loadError: string | null;
  saveError: string | null;
  dirty: boolean;
  totalSize: number;
  loadedSize: number;
  hasMore: boolean;
  loadingMore: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:content', v: string): void;
  (e: 'save'): void;
  (e: 'load-more'): void;
}>();

// Partial files are read-only — saving would silently truncate everything
// past the loaded window. Editor extension check is still required (only
// .md / .json are writable in the API).
const editable = computed(() => {
  if (!props.path) return false;
  if (props.hasMore) return false;
  return props.path.endsWith('.md') || props.path.endsWith('.json');
});

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
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
        <p
          v-if="!loading && totalSize > 0"
          class="shrink-0 text-xs text-muted-foreground"
          :title="hasMore ? 'File loaded partially — editing disabled until fully loaded' : ''"
        >
          {{ hasMore
            ? `${formatBytes(loadedSize)} of ${formatBytes(totalSize)} loaded`
            : formatBytes(totalSize) }}
        </p>
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
      <template v-else>
        <AgentFileEditor
          :value="content"
          :saving="saving"
          :error="saveError"
          :read-only="!editable"
          :dirty="dirty"
          class="flex-1"
          @update:value="(v: string) => emit('update:content', v)"
          @save="emit('save')"
        />
        <div
          v-if="hasMore"
          class="mt-3 flex items-center justify-center"
        >
          <Button
            variant="outline"
            size="sm"
            :disabled="loadingMore"
            @click="emit('load-more')"
          >
            <IconChevronDown
              class="size-4"
              :class="loadingMore && 'animate-bounce'"
            />
            {{ loadingMore ? 'Loading…' : 'Load more' }}
          </Button>
        </div>
      </template>
    </template>
  </div>
</template>
