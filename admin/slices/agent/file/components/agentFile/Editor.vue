<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import { IconDeviceFloppy, IconArrowBackUp } from '@tabler/icons-vue';
import type * as Monaco from 'monaco-editor';
import { languageFor, languageLabel, monacoTheme, useMonaco } from '#agentFile/composables/useMonaco';
import { useAgentFileStore } from '#agentFile/stores/agentFile';

/**
 * Monaco-backed editor for one workspace file (CLEAN-112, US1).
 *
 * Reads the loaded slices and the draft from the store; writes the draft
 * back on every edit. Read-only until the whole file is loaded and the API
 * says it is editable. Scrolling near the end of a partially loaded file
 * asks the store for the next slice, which is appended in place.
 */
const props = defineProps<{
  agentId: string;
  path: string;
  saving: boolean;
  saveError: string | null;
  /** From a chat proposal — shown in the status strip. */
  proposalId?: string | null;
}>();

const emit = defineEmits<{
  (e: 'save'): void;
  (e: 'discard'): void;
  (e: 'compare'): void;
}>();

const store = useAgentFileStore();

const loaded = computed(() => store.loadedFor(props.agentId, props.path));
const draft = computed(() => store.draftFor(props.agentId, props.path));
const dirty = computed(() => store.isDirty(props.agentId, props.path));
const readOnly = computed(
  () => !loaded.value || loaded.value.loading || loaded.value.hasMore || !loaded.value.editable,
);
const isJson = computed(() => languageFor(props.path) === 'json');

const host = ref<HTMLDivElement | null>(null);
const monacoRef = shallowRef<typeof Monaco | null>(null);
const editor = shallowRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
const model = shallowRef<Monaco.editor.ITextModel | null>(null);
const bootError = ref<string | null>(null);

const cursor = ref({ line: 1, column: 1 });
const jsonValid = ref<boolean | null>(null);
const jsonMessage = ref<string | null>(null);

// Guard so programmatic content updates (slices arriving) do not become drafts.
let applying = false;
const disposables: Monaco.IDisposable[] = [];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const progress = computed(() => {
  const l = loaded.value;
  if (!l) return null;
  if (l.hasMore || l.loading) {
    return `loaded ${formatBytes(l.content.length)} of ${formatBytes(l.totalSize)}`;
  }
  return null;
});

const readOnlyReason = computed(() => {
  const l = loaded.value;
  if (!l) return null;
  if (l.hasMore || l.loading) return 'Editing unlocks once the whole file is loaded';
  if (l.kind !== 'text') return 'Binary file';
  if (!l.editable) return 'Too large to edit here — download or open full';
  return null;
});

async function boot() {
  if (!host.value) return;
  try {
    const monaco = await useMonaco();
    monacoRef.value = monaco;
    const ed = monaco.editor.create(host.value, {
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 12,
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      wordWrap: 'off',
      theme: monacoTheme(),
      readOnly: true,
      renderWhitespace: 'none',
      tabSize: 2,
    });
    editor.value = ed;

    disposables.push(
      ed.onDidChangeCursorPosition((e) => {
        cursor.value = { line: e.position.lineNumber, column: e.position.column };
      }),
      ed.onDidScrollChange(() => maybeLoadMore()),
      ed.onDidChangeModelContent(() => {
        if (applying) return;
        const value = ed.getValue();
        store.setDraft(props.agentId, props.path, value);
      }),
      monaco.editor.onDidChangeMarkers((uris) => {
        const m = model.value;
        if (!m || !uris.some((u) => u.toString() === m.uri.toString())) return;
        refreshMarkers();
      }),
    );
    // Ctrl/⌘+S saves (Monaco swallows the browser shortcut when focused).
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (!readOnly.value && dirty.value && !props.saving) emit('save');
    });

    // Theme follows the console's dark class.
    const observer = new MutationObserver(() => {
      monaco.editor.setTheme(monacoTheme());
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    disposables.push({ dispose: () => observer.disconnect() });

    attachModel();
  } catch (err) {
    bootError.value = (err as Error).message || 'Editor failed to load';
  }
}

function refreshMarkers() {
  const monaco = monacoRef.value;
  const m = model.value;
  if (!monaco || !m || !isJson.value) {
    jsonValid.value = null;
    jsonMessage.value = null;
    return;
  }
  const errors = monaco.editor
    .getModelMarkers({ resource: m.uri })
    .filter((mk) => mk.severity === monaco.MarkerSeverity.Error);
  jsonValid.value = errors.length === 0;
  jsonMessage.value = errors[0]
    ? `line ${errors[0].startLineNumber} col ${errors[0].startColumn}: ${errors[0].message}`
    : null;
}

/** (Re)create the model for the current path with draft-or-loaded content. */
function attachModel() {
  const monaco = monacoRef.value;
  const ed = editor.value;
  if (!monaco || !ed) return;
  const uri = monaco.Uri.parse(`ranch://${props.agentId}/${props.path}`);
  const initial = draft.value?.content ?? loaded.value?.content ?? '';
  let m = monaco.editor.getModel(uri);
  applying = true;
  if (!m) {
    m = monaco.editor.createModel(initial, languageFor(props.path), uri);
  } else if (m.getValue() !== initial) {
    m.setValue(initial);
  }
  applying = false;
  model.value = m;
  ed.setModel(m);
  ed.updateOptions({ readOnly: readOnly.value });
  cursor.value = { line: 1, column: 1 };
  refreshMarkers();
  maybeLoadMore();
}

/** A new slice arrived: append it without touching the viewport. */
function appendLoaded(previous: string, next: string) {
  const m = model.value;
  const ed = editor.value;
  if (!m || !ed) return;
  if (draft.value) return; // never rewrite a draft under the operator
  const current = m.getValue();
  if (next.startsWith(current) && current.length === previous.length) {
    const tail = next.slice(current.length);
    if (!tail) return;
    const end = m.getFullModelRange().getEndPosition();
    applying = true;
    m.applyEdits([{ range: new (monacoRef.value as typeof Monaco).Range(end.lineNumber, end.column, end.lineNumber, end.column), text: tail }]);
    applying = false;
  } else {
    applying = true;
    m.setValue(next);
    applying = false;
  }
}

function maybeLoadMore() {
  const l = loaded.value;
  const ed = editor.value;
  if (!l || !l.hasMore || l.loading || !ed) return;
  const layout = ed.getLayoutInfo();
  const scrollTop = ed.getScrollTop();
  const scrollHeight = ed.getScrollHeight();
  // Within two screens of the end → fetch the next slice.
  if (scrollTop + layout.height * 3 >= scrollHeight) {
    void store.fetchMore(props.agentId, props.path);
  }
}

watch(
  () => loaded.value?.content ?? '',
  (next, previous) => {
    if (next !== previous) appendLoaded(previous ?? '', next);
  },
);

watch(readOnly, (ro) => editor.value?.updateOptions({ readOnly: ro }));

watch(
  () => props.path,
  () => attachModel(),
);

// A discard (draft cleared while the model holds the draft text) resets the
// model to the loaded content.
watch(
  () => draft.value?.content,
  (next) => {
    const m = model.value;
    if (!m) return;
    if (next === undefined) {
      const base = loaded.value?.content ?? '';
      if (m.getValue() !== base) {
        applying = true;
        m.setValue(base);
        applying = false;
      }
    } else if (m.getValue() !== next) {
      applying = true;
      m.setValue(next);
      applying = false;
    }
  },
);

onMounted(() => {
  void boot();
});

onBeforeUnmount(() => {
  for (const d of disposables) d.dispose();
  editor.value?.dispose();
  editor.value = null;
});
</script>

<template>
  <div class="flex h-full min-h-[480px] flex-col">
    <div
      v-if="proposalId"
      class="flex flex-wrap items-center gap-2 border-b bg-sky-500/10 px-3 py-1.5 text-xs text-sky-900 dark:text-sky-200"
    >
      <span class="flex-1">From a chat proposal — review, then Save to apply it.</span>
      <Button variant="outline" size="sm" @click="emit('compare')">Compare</Button>
    </div>
    <div class="relative flex-1">
      <div ref="host" class="absolute inset-0" />
      <div
        v-if="bootError"
        class="absolute inset-0 flex items-center justify-center bg-background/80 p-4 text-xs text-destructive"
      >
        {{ bootError }}
      </div>
      <div
        v-else-if="!monacoRef || loaded?.loading && !loaded?.content"
        class="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground"
      >
        Loading…
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-1.5 text-xs">
      <p v-if="saveError" class="min-w-0 flex-1 truncate text-destructive" :title="saveError">
        {{ saveError }}
      </p>
      <p v-else-if="loaded?.error" class="min-w-0 flex-1 truncate text-destructive" :title="loaded.error">
        {{ loaded.error }}
      </p>
      <p v-else-if="progress" class="min-w-0 flex-1 truncate text-muted-foreground">
        {{ progress }}
      </p>
      <p v-else-if="readOnlyReason" class="min-w-0 flex-1 truncate text-muted-foreground">
        Read only — {{ readOnlyReason }}
      </p>
      <p v-else-if="dirty" class="min-w-0 flex-1 truncate text-amber-700 dark:text-amber-300">
        ● Unsaved changes · applies on next restart
      </p>
      <p v-else class="min-w-0 flex-1 truncate text-muted-foreground">Saved</p>

      <span class="text-muted-foreground">Ln {{ cursor.line }}, Col {{ cursor.column }}</span>
      <span class="text-muted-foreground">{{ languageLabel(path) }}</span>
      <span
        v-if="isJson && jsonValid !== null"
        :class="jsonValid ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'"
        :title="jsonMessage ?? ''"
      >
        {{ jsonValid ? 'Valid JSON ✓' : 'Invalid JSON' }}
      </span>
      <Button
        v-if="dirty"
        variant="ghost"
        size="sm"
        :disabled="saving"
        @click="emit('discard')"
      >
        <IconArrowBackUp class="size-4" />
        Discard
      </Button>
      <Button
        size="sm"
        :disabled="readOnly || !dirty || saving || (isJson && jsonValid === false)"
        :title="isJson && jsonValid === false ? 'Fix the JSON before saving' : 'Save (Ctrl/⌘+S)'"
        @click="emit('save')"
      >
        <IconDeviceFloppy class="size-4" :class="saving && 'animate-pulse'" />
        {{ saving ? 'Saving…' : 'Save' }}
      </Button>
    </div>
  </div>
</template>
