<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import { Input } from '#theme/components/ui/input';
import { Label } from '#theme/components/ui/label';
import { Textarea } from '#theme/components/ui/textarea';
import type { SourceType } from '#reins/stores/knowledge';

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
const file = ref<File | null>(null);

function reset() {
  type.value = 'text';
  name.value = '';
  content.value = '';
  url.value = '';
  file.value = null;
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
      if (!file.value) throw new Error('Pick a file first');
      await store.addFileSource(props.knowledgeId, file.value);
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

function onFileChange(e: Event) {
  const target = e.target as HTMLInputElement;
  const picked = target.files?.[0];
  file.value = picked ?? null;
  if (picked && !name.value) name.value = picked.name;
}

function cancel() {
  reset();
  open.value = false;
}
</script>

<template>
  <div class="rounded-md border bg-card p-4">
    <div v-if="!open" class="flex items-center justify-between">
      <p class="text-sm text-muted-foreground">Add a source (text, URL, or file).</p>
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
          <option value="file">File</option>
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
        <Label for="source-file">File</Label>
        <input
          id="source-file"
          type="file"
          class="text-sm"
          @change="onFileChange"
        />
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
