<script setup lang="ts">
import type { SourceType } from '#reins/stores/knowledge';

// Mirrors MAX_FILES_PER_BATCH in the API's source.controller.
const MAX_FILES_PER_BATCH = 250;

const props = defineProps<{ knowledgeId: string }>();
const emit = defineEmits<{ added: [] }>();

const store = useKnowledgeStore();
const open = ref(false);
const submitting = ref(false);
const errorMessage = ref<string | null>(null);

const type = ref<SourceType>('text');
const name = ref('');
const content = ref('');
const url = ref('');
const files = ref<File[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);

function reset() {
  type.value = 'text';
  name.value = '';
  content.value = '';
  url.value = '';
  files.value = [];
  if (fileInput.value) fileInput.value.value = '';
  errorMessage.value = null;
}

async function submit() {
  submitting.value = true;
  errorMessage.value = null;
  try {
    if (type.value === 'text') {
      if (!name.value.trim() || !content.value.trim()) {
        throw new Error('Name and content are required');
      }
      await store.addTextSource(
        props.knowledgeId,
        name.value.trim(),
        content.value,
      );
    } else if (type.value === 'url') {
      if (!name.value.trim() || !url.value.trim()) {
        throw new Error('Name and URL are required');
      }
      await store.addUrlSource(
        props.knowledgeId,
        name.value.trim(),
        url.value.trim(),
      );
    } else if (type.value === 'file') {
      if (!files.value.length) throw new Error('Pick at least one file');
      // Checked here as well as server-side: past the cap the upload is
      // rejected only after the whole body has been sent, so catching it
      // before the request saves uploading a batch that cannot be accepted.
      if (files.value.length > MAX_FILES_PER_BATCH) {
        throw new Error(
          `Too many files: ${files.value.length}. Add at most ${MAX_FILES_PER_BATCH} at a time, or use "Upload archive" below for a larger set.`,
        );
      }
      const result = await store.addFileSources(props.knowledgeId, files.value);
      // A batch can partly succeed. Refresh the list either way, but keep the
      // form open with the reason when something was rejected, so the user
      // isn't left guessing why fewer sources appeared than files picked.
      emit('added');
      if (result.failed > 0 || result.added === 0) {
        errorMessage.value = summarize(result);
        return;
      }
      reset();
      open.value = false;
      return;
    }
    emit('added');
    reset();
    open.value = false;
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } }; message?: string };
    errorMessage.value = e?.response?.data?.message ?? e?.message ?? 'Add failed';
  } finally {
    submitting.value = false;
  }
}

function summarize(result: {
  added: number;
  skipped: number;
  failed: number;
  errors: string[];
}): string {
  const parts = [`${result.added} added`];
  if (result.skipped) parts.push(`${result.skipped} already existed`);
  if (result.failed) parts.push(`${result.failed} failed`);
  const head = parts.join(', ');
  return result.errors.length ? `${head}. ${result.errors.join('; ')}` : head;
}

function onFileChange(e: Event) {
  const target = e.target as HTMLInputElement;
  files.value = target.files ? Array.from(target.files) : [];
}

function cancel() {
  reset();
  open.value = false;
}
</script>

<template>
  <div class="rounded-md border bg-card p-4">
    <div v-if="!open" class="flex items-center justify-between">
      <p class="text-sm text-muted-foreground">Add a source (text, URL, or files).</p>
      <Button size="sm" @click="open = true">Add source</Button>
    </div>

    <form v-else class="flex flex-col gap-4" @submit.prevent="submit">
      <div class="grid gap-2">
        <Label for="source-type">Type</Label>
        <select
          id="source-type"
          v-model="type"
          class="h-9 w-full rounded-md border bg-background px-3 text-sm"
        >
          <option value="text">Text</option>
          <option value="url">URL</option>
          <option value="file">Files</option>
        </select>
      </div>

      <div v-if="type !== 'file'" class="grid gap-2">
        <Label for="source-name">Name</Label>
        <Input id="source-name" v-model="name" />
      </div>

      <div v-if="type === 'text'" class="grid gap-2">
        <Label for="source-content">Content</Label>
        <Textarea id="source-content" v-model="content" rows="8" />
      </div>

      <div v-if="type === 'url'" class="grid gap-2">
        <Label for="source-url">URL</Label>
        <Input id="source-url" v-model="url" placeholder="https://example.com/doc" />
      </div>

      <div v-if="type === 'file'" class="grid gap-2">
        <Label for="source-file">Files</Label>
        <input
          id="source-file"
          ref="fileInput"
          type="file"
          multiple
          class="text-sm"
          @change="onFileChange"
        />
        <p class="text-xs text-muted-foreground">
          Pick one or several files (up to {{ MAX_FILES_PER_BATCH }}). Each
          becomes its own source; names already present on this knowledge are
          skipped. For a larger set use "Upload archive" below.
        </p>
        <p v-if="files.length" class="text-xs text-muted-foreground">
          Selected: {{ files.map((f) => f.name).join(', ') }}
        </p>
      </div>

      <p v-if="errorMessage" class="text-xs text-destructive">{{ errorMessage }}</p>

      <div class="flex items-center gap-2">
        <Button type="submit" :disabled="submitting">
          {{ submitting ? 'Saving…' : 'Add' }}
        </Button>
        <Button type="button" variant="ghost" @click="cancel">Cancel</Button>
      </div>
    </form>
  </div>
</template>
