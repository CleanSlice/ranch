<script setup lang="ts">
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui';
import { Button } from '#theme/components/ui/button';
import { SaveRefusedError } from '#agentFile/domain';
import { useAgentFileStore } from '#agentFile/stores/agentFile';
import { validateNewPath } from '#agentFile/utils/fileTree';

/**
 * New file (CLEAN-112, US5): a relative path, created empty with
 * `createOnly` so an existing file is never overwritten. The API decides the
 * kind; a binary extension is refused with its message.
 */
const props = defineProps<{ open: boolean; agentId: string; folder?: string | null }>();
const emit = defineEmits<{
  (e: 'update:open', v: boolean): void;
  (e: 'created', path: string): void;
}>();

const store = useAgentFileStore();

const isOpen = computed({
  get: () => props.open,
  set: (v: boolean) => emit('update:open', v),
});

const path = ref('');
const error = ref<string | null>(null);
const busy = ref(false);
const input = ref<HTMLInputElement | null>(null);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    path.value = props.folder ? `${props.folder.replace(/\/$/, '')}/` : '';
    error.value = null;
    void nextTick(() => input.value?.focus());
  },
);

const validation = computed(() => (path.value ? validateNewPath(path.value) : null));

async function create() {
  const p = path.value.trim();
  const invalid = validateNewPath(p);
  if (invalid) {
    error.value = invalid;
    return;
  }
  if (store.nodeFor(props.agentId, p)) {
    error.value = `${p} already exists`;
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await store.save(props.agentId, p, '', { createOnly: true });
    emit('created', p);
    isOpen.value = false;
  } catch (err) {
    error.value =
      err instanceof SaveRefusedError && err.reason === 'exists'
        ? `${p} already exists`
        : (err as Error).message || 'Could not create the file';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <DialogRoot v-model:open="isOpen">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/80" />
      <DialogContent
        class="fixed top-1/2 left-1/2 z-50 flex w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-lg border bg-background p-6 shadow-lg"
        @keydown.enter.prevent="create"
      >
        <div class="flex flex-col gap-1">
          <DialogTitle class="text-lg font-semibold">New file</DialogTitle>
          <DialogDescription class="text-sm text-muted-foreground">
            A path relative to the workspace, for example <code>notes/todo.md</code>. Folders are created as needed.
          </DialogDescription>
        </div>
        <input
          ref="input"
          v-model="path"
          type="text"
          spellcheck="false"
          placeholder="notes/todo.md"
          class="h-9 w-full rounded-md border bg-background px-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
        <p v-else-if="validation" class="text-xs text-muted-foreground">{{ validation }}</p>
        <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" :disabled="busy" @click="isOpen = false">Cancel</Button>
          <Button :disabled="busy || !path.trim() || !!validation" @click="create">
            {{ busy ? 'Creating…' : 'Create' }}
          </Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
