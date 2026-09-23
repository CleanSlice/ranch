<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import { IconDeviceFloppy } from '@tabler/icons-vue';

/**
 * Plain viewer/editor for template files. Templates are small text files
 * seeded into agents; the agent Files tab moved to a code editor (CLEAN-112)
 * and keeps its own component, so this one stays deliberately simple.
 */
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

const editable = computed(
  () => !!props.path && (props.path.endsWith('.md') || props.path.endsWith('.json')),
);

function onInput(e: Event) {
  emit('update:content', (e.target as HTMLTextAreaElement).value);
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
      <div v-else class="flex h-full flex-col gap-2">
        <textarea
          :value="content"
          :readonly="!editable"
          spellcheck="false"
          class="min-h-[280px] flex-1 resize-none rounded-md border bg-muted/20 p-3 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
          @input="onInput"
        />
        <div class="flex items-center justify-between gap-2">
          <p v-if="saveError" class="truncate text-xs text-destructive" :title="saveError">
            {{ saveError }}
          </p>
          <p v-else-if="!editable" class="text-xs text-muted-foreground">
            Read only — only .md and .json template files can be edited
          </p>
          <p v-else-if="dirty" class="text-xs text-muted-foreground">Unsaved changes</p>
          <p v-else class="text-xs text-muted-foreground">Saved</p>

          <Button size="sm" :disabled="!editable || !dirty || saving" @click="emit('save')">
            <IconDeviceFloppy class="size-4" :class="saving && 'animate-pulse'" />
            Save
          </Button>
        </div>
      </div>
    </template>
  </div>
</template>
