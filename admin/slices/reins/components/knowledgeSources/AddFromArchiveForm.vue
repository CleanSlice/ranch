<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import { Label } from '#theme/components/ui/label';

const props = defineProps<{ knowledgeId: string }>();
const emit = defineEmits<{ added: [] }>();

const store = useKnowledgeStore();
const open = ref(false);
const submitting = ref(false);
const errorMessage = ref<string | null>(null);
const successMessage = ref<string | null>(null);
const file = ref<File | null>(null);

function onFileChange(e: Event) {
  const target = e.target as HTMLInputElement;
  file.value = target.files?.[0] ?? null;
}

async function submit() {
  if (!file.value) {
    errorMessage.value = 'Pick a .zip archive first';
    return;
  }
  submitting.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  try {
    const result = await store.addSourcesFromArchive(
      props.knowledgeId,
      file.value,
    );
    successMessage.value = `Detected ${result.detected} file${result.detected === 1 ? '' : 's'}. Importing in the background - refresh the list to watch sources appear, then run Index.`;
    emit('added');
    file.value = null;
  } catch (err: unknown) {
    const e = err as {
      response?: { data?: { message?: string } };
      message?: string;
    };
    errorMessage.value =
      e?.response?.data?.message ?? e?.message ?? 'Archive import failed';
  } finally {
    submitting.value = false;
  }
}

function cancel() {
  file.value = null;
  errorMessage.value = null;
  successMessage.value = null;
  open.value = false;
}
</script>

<template>
  <div class="rounded-md border bg-card p-4">
    <div v-if="!open" class="flex items-center justify-between">
      <p class="text-sm text-muted-foreground">
        Bulk-import a .zip of documents (pdf, docx, xlsx, txt, html, ...) as
        file sources.
      </p>
      <Button size="sm" variant="outline" @click="open = true">
        Upload archive
      </Button>
    </div>

    <form v-else class="flex flex-col gap-4" @submit.prevent="submit">
      <div class="grid gap-2">
        <Label for="archive-file">Zip archive</Label>
        <input
          id="archive-file"
          type="file"
          accept=".zip,application/zip"
          class="text-sm"
          @change="onFileChange"
        />
        <p class="text-xs text-muted-foreground">
          Every supported file inside becomes a source. Unsupported files
          (images, video) and macOS metadata are skipped automatically.
        </p>
      </div>

      <p v-if="errorMessage" class="text-xs text-destructive">
        {{ errorMessage }}
      </p>
      <p v-if="successMessage" class="text-xs text-emerald-600">
        {{ successMessage }}
      </p>

      <div class="flex items-center gap-2">
        <Button type="submit" :disabled="submitting">
          {{ submitting ? 'Uploading…' : 'Upload' }}
        </Button>
        <Button type="button" variant="ghost" @click="cancel">Close</Button>
      </div>
    </form>
  </div>
</template>
