<script setup lang="ts">
import { errorMessageOf } from '#reins/domain';

// Mirrors MAX_FILES_PER_BATCH in the API's source.controller.
const MAX_FILES_PER_BATCH = 250;

/**
 * Every way a source can enter a knowledge base, in one place. These used to be
 * three permanently expanded cards stacked above the table, which cost most of
 * the first screen to advertise actions taken once and then never again. A
 * sheet keeps the table at the top of the page and gives each mode room for its
 * own explanation.
 */
type AddMode = 'files' | 'archive' | 'text' | 'url' | 'sitemap';

const MODES: readonly { value: AddMode; label: string }[] = [
  { value: 'files', label: 'Files' },
  { value: 'archive', label: 'Archive' },
  { value: 'text', label: 'Text' },
  { value: 'url', label: 'URL' },
  { value: 'sitemap', label: 'Sitemap' },
];

const SUBMIT_LABELS: Record<AddMode, string> = {
  files: 'Upload',
  archive: 'Upload',
  text: 'Add',
  url: 'Add',
  sitemap: 'Import',
};

function isAddMode(value: unknown): value is AddMode {
  return MODES.some((m) => m.value === value);
}

const props = defineProps<{ knowledgeId: string }>();
const emit = defineEmits<{ added: [] }>();

const store = useKnowledgeStore();

const open = ref(false);
const mode = ref<AddMode>('files');
const submitting = ref(false);
const errorMessage = ref<string | null>(null);
const successMessage = ref<string | null>(null);

const name = ref('');
const content = ref('');
const url = ref('');
const files = ref<File[]>([]);
const archive = ref<File | null>(null);
const sitemapUrl = ref('');
const urlPrefix = ref('');

const fileInput = ref<HTMLInputElement | null>(null);
const archiveInput = ref<HTMLInputElement | null>(null);

function clearMessages(): void {
  errorMessage.value = null;
  successMessage.value = null;
}

function resetAll(): void {
  name.value = '';
  content.value = '';
  url.value = '';
  files.value = [];
  archive.value = null;
  sitemapUrl.value = '';
  urlPrefix.value = '';
  if (fileInput.value) fileInput.value.value = '';
  if (archiveInput.value) archiveInput.value.value = '';
  clearMessages();
}

// A message about a zip is meaningless once the user is looking at the text
// form, so switching modes wipes the notices but keeps whatever was typed.
function selectMode(value: unknown): void {
  if (!isAddMode(value)) return;
  mode.value = value;
  clearMessages();
}

function onFilesChange(e: Event): void {
  const target = e.target as HTMLInputElement;
  files.value = target.files ? Array.from(target.files) : [];
}

function onArchiveChange(e: Event): void {
  const target = e.target as HTMLInputElement;
  archive.value = target.files?.[0] ?? null;
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

interface AddOutcome {
  /** Close the sheet: nothing left on screen the user still has to read. */
  close: boolean;
  notice: string | null;
  /**
   * The request went through but not everything landed. Distinct from a thrown
   * error, which means nothing was sent at all - a half-successful batch still
   * changed the list, so the table has to be refreshed either way.
   */
  problem: string | null;
}

/**
 * Text, URL and a clean file batch are finished the moment they return. A
 * sitemap or an archive reports a count the user needs to read, and an archive
 * keeps running in the background after the request returns, so those stay open
 * with the result on screen.
 *
 * Validation failures throw, because nothing reached the server.
 */
async function runMode(): Promise<AddOutcome> {
  const id = props.knowledgeId;
  const done: AddOutcome = { close: true, notice: null, problem: null };

  if (mode.value === 'text') {
    if (!name.value.trim() || !content.value.trim()) {
      throw new Error('Name and content are required');
    }
    await store.addTextSource(id, name.value.trim(), content.value);
    return done;
  }

  if (mode.value === 'url') {
    if (!name.value.trim() || !url.value.trim()) {
      throw new Error('Name and URL are required');
    }
    await store.addUrlSource(id, name.value.trim(), url.value.trim());
    return done;
  }

  if (mode.value === 'files') {
    if (!files.value.length) throw new Error('Pick at least one file');
    // Checked here as well as server-side: past the cap the upload is rejected
    // only after the whole body has been sent, so catching it before the
    // request saves uploading a batch that cannot be accepted.
    if (files.value.length > MAX_FILES_PER_BATCH) {
      throw new Error(
        `Too many files: ${files.value.length}. Add at most ${MAX_FILES_PER_BATCH} at a time, or use the Archive tab for a larger set.`,
      );
    }
    const result = await store.addFileSources(id, files.value);
    if (result.failed > 0 || result.added === 0) {
      return { close: false, notice: null, problem: summarize(result) };
    }
    return done;
  }

  if (mode.value === 'archive') {
    if (!archive.value) throw new Error('Pick a .zip archive first');
    const result = await store.addSourcesFromArchive(id, archive.value);
    archive.value = null;
    if (archiveInput.value) archiveInput.value.value = '';
    return {
      close: false,
      problem: null,
      notice: `Detected ${result.detected} file${result.detected === 1 ? '' : 's'}. Importing in the background - progress shows under the table; run Index once it finishes.`,
    };
  }

  if (!sitemapUrl.value.trim()) throw new Error('Sitemap URL is required');
  const result = await store.addSourcesFromSitemap(
    id,
    sitemapUrl.value.trim(),
    urlPrefix.value.trim() || undefined,
  );
  sitemapUrl.value = '';
  urlPrefix.value = '';
  return {
    close: false,
    problem: null,
    notice: `Added ${result.added} of ${result.discovered} discovered URL${result.discovered === 1 ? '' : 's'}. Run Index to ingest them.`,
  };
}

async function submit(): Promise<void> {
  submitting.value = true;
  clearMessages();
  try {
    const outcome = await runMode();
    // Reached the server, so the list has moved - refresh it before deciding
    // what to show, including for a batch that only partly landed.
    emit('added');
    if (outcome.problem) {
      errorMessage.value = outcome.problem;
      return;
    }
    if (outcome.close) {
      open.value = false;
      return;
    }
    successMessage.value = outcome.notice;
  } catch (err: unknown) {
    errorMessage.value = errorMessageOf(err, 'Could not add sources');
  } finally {
    submitting.value = false;
  }
}

watch(open, (isOpen) => {
  if (!isOpen) resetAll();
});
</script>

<template>
  <Sheet v-model:open="open">
    <SheetTrigger as-child>
      <Button size="sm">Add sources</Button>
    </SheetTrigger>

    <SheetContent side="right" class="flex w-full flex-col sm:max-w-xl">
      <SheetHeader>
        <SheetTitle>Add sources</SheetTitle>
        <SheetDescription>
          Anything added here is stored but not searchable until the next Index
          run.
        </SheetDescription>
      </SheetHeader>

      <form class="flex min-h-0 flex-1 flex-col gap-4" @submit.prevent="submit">
        <Tabs
          :model-value="mode"
          class="flex min-h-0 flex-1 flex-col gap-4"
          @update:model-value="selectMode"
        >
          <TabsList class="mx-4 grid grid-cols-5">
            <TabsTrigger v-for="m in MODES" :key="m.value" :value="m.value">
              {{ m.label }}
            </TabsTrigger>
          </TabsList>

          <div class="min-h-0 flex-1 overflow-y-auto px-4">
            <TabsContent value="files" class="grid gap-2">
              <Label for="add-files">Files</Label>
              <input
                id="add-files"
                ref="fileInput"
                type="file"
                multiple
                class="text-sm"
                @change="onFilesChange"
              >
              <p class="text-xs text-muted-foreground">
                Up to {{ MAX_FILES_PER_BATCH }} at a time. Each file becomes its
                own source; names already on this knowledge are skipped.
              </p>
              <p v-if="files.length" class="text-xs text-muted-foreground">
                Selected {{ files.length }}: {{ files.map((f) => f.name).join(', ') }}
              </p>
            </TabsContent>

            <TabsContent value="archive" class="grid gap-2">
              <Label for="add-archive">Zip archive</Label>
              <input
                id="add-archive"
                ref="archiveInput"
                type="file"
                accept=".zip,application/zip"
                class="text-sm"
                @change="onArchiveChange"
              >
              <p class="text-xs text-muted-foreground">
                Every supported file inside (pdf, docx, xlsx, txt, html, …)
                becomes a source. Images, video and macOS metadata are skipped.
                Large archives are fine: the zip streams to disk and files
                upload one by one.
              </p>
            </TabsContent>

            <TabsContent value="text" class="grid gap-4">
              <div class="grid gap-2">
                <Label for="add-text-name">Name</Label>
                <Input id="add-text-name" v-model="name" />
              </div>
              <div class="grid gap-2">
                <Label for="add-text-content">Content</Label>
                <Textarea id="add-text-content" v-model="content" rows="12" />
              </div>
            </TabsContent>

            <TabsContent value="url" class="grid gap-4">
              <div class="grid gap-2">
                <Label for="add-url-name">Name</Label>
                <Input id="add-url-name" v-model="name" />
              </div>
              <div class="grid gap-2">
                <Label for="add-url-value">URL</Label>
                <Input
                  id="add-url-value"
                  v-model="url"
                  placeholder="https://example.com/doc"
                />
              </div>
            </TabsContent>

            <TabsContent value="sitemap" class="grid gap-4">
              <div class="grid gap-2">
                <Label for="add-sitemap-url">Sitemap URL</Label>
                <Input
                  id="add-sitemap-url"
                  v-model="sitemapUrl"
                  placeholder="https://example.com/sitemap.xml"
                />
                <p class="text-xs text-muted-foreground">
                  A sitemap.xml or a sitemap index. Every page it lists is added
                  as a url-type source.
                </p>
              </div>
              <div class="grid gap-2">
                <Label for="add-sitemap-prefix">URL prefix filter (optional)</Label>
                <Input
                  id="add-sitemap-prefix"
                  v-model="urlPrefix"
                  placeholder="https://example.com/docs/"
                />
                <p class="text-xs text-muted-foreground">
                  Only URLs starting with this prefix are added. Leave empty to
                  import the whole sitemap.
                </p>
              </div>
            </TabsContent>

            <p v-if="errorMessage" class="mt-4 text-sm text-destructive">
              {{ errorMessage }}
            </p>
            <p v-if="successMessage" class="mt-4 text-sm text-emerald-600">
              {{ successMessage }}
            </p>
          </div>
        </Tabs>

        <SheetFooter class="gap-2">
          <Button type="submit" :disabled="submitting">
            {{ submitting ? 'Working…' : SUBMIT_LABELS[mode] }}
          </Button>
          <Button type="button" variant="ghost" @click="open = false">
            Close
          </Button>
        </SheetFooter>
      </form>
    </SheetContent>
  </Sheet>
</template>
