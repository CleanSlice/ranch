<script setup lang="ts">
import type * as Monaco from 'monaco-editor';
import { Button } from '#theme/components/ui/button';
import { IconX } from '@tabler/icons-vue';
import { languageFor, monacoTheme, useMonaco } from '#agentFile/composables/useMonaco';

/**
 * Side-by-side comparison of the stored file and a proposed version
 * (CLEAN-112, US4). Read-only; opened from a proposal card or the editor's
 * "Compare" strip. The caller decides whether the sizes are within the
 * comparison cap — this component only paints what it is given.
 */
const props = defineProps<{
  path: string;
  original: string;
  modified: string;
  originalLabel?: string;
  modifiedLabel?: string;
}>();

const emit = defineEmits<{ (e: 'close'): void }>();

const host = ref<HTMLDivElement | null>(null);
const bootError = ref<string | null>(null);
let editor: Monaco.editor.IStandaloneDiffEditor | null = null;
let models: Monaco.editor.ITextModel[] = [];
let observer: MutationObserver | null = null;

onMounted(async () => {
  if (!host.value) return;
  try {
    const monaco = await useMonaco();
    const language = languageFor(props.path);
    const original = monaco.editor.createModel(props.original, language);
    const modified = monaco.editor.createModel(props.modified, language);
    models = [original, modified];
    editor = monaco.editor.createDiffEditor(host.value, {
      automaticLayout: true,
      readOnly: true,
      originalEditable: false,
      renderSideBySide: true,
      minimap: { enabled: false },
      fontSize: 12,
      theme: monacoTheme(),
      scrollBeyondLastLine: false,
    });
    editor.setModel({ original, modified });
    observer = new MutationObserver(() => monaco.editor.setTheme(monacoTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  } catch (err) {
    bootError.value = (err as Error).message || 'Comparison failed to load';
  }
});

onBeforeUnmount(() => {
  observer?.disconnect();
  editor?.dispose();
  for (const m of models) m.dispose();
});
</script>

<template>
  <div class="flex h-full min-h-[480px] flex-col">
    <div class="flex items-center gap-3 border-b px-3 py-1.5 text-xs">
      <span class="truncate font-mono" :title="path">{{ path }}</span>
      <span class="text-muted-foreground">{{ originalLabel ?? 'stored' }} → {{ modifiedLabel ?? 'proposed' }}</span>
      <Button variant="ghost" size="sm" class="ml-auto h-6 px-1.5" @click="emit('close')">
        <IconX class="size-3.5" />
        Close
      </Button>
    </div>
    <div class="relative flex-1">
      <div ref="host" class="absolute inset-0" />
      <div
        v-if="bootError"
        class="absolute inset-0 flex items-center justify-center bg-background/80 p-4 text-xs text-destructive"
      >
        {{ bootError }}
      </div>
    </div>
  </div>
</template>
