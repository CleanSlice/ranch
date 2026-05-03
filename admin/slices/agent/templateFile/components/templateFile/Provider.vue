<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '#theme/components/ui/sheet';
import {
  IconFiles,
  IconRefresh,
  IconUpload,
} from '@tabler/icons-vue';
import AgentFileTree from '#agentFile/components/agentFile/Tree.vue';
import AgentFileViewer from '#agentFile/components/agentFile/Viewer.vue';

const props = defineProps<{ id: string }>();

const store = useTemplateFileStore();

const listLoading = ref(false);
const listError = ref<string | null>(null);

const selected = ref<string | null>(null);
const original = ref<string>('');
const content = ref<string>('');

const contentLoading = ref(false);
const contentError = ref<string | null>(null);

const saving = ref(false);
const saveError = ref<string | null>(null);

const uploading = ref(false);
const uploadError = ref<string | null>(null);

const sheetOpen = ref(false);
const folderInput = ref<HTMLInputElement | null>(null);

const dirty = computed(() => content.value !== original.value);

const ROOT_PREFIX = '.agent/';

function stripRoot(p: string): string {
  return p.startsWith(ROOT_PREFIX) ? p.slice(ROOT_PREFIX.length) : p;
}

const treeFiles = computed(() =>
  store.nodes.map((n) => ({ ...n, path: stripRoot(n.path) })),
);

const treeSelected = computed(() =>
  selected.value ? stripRoot(selected.value) : null,
);

function onTreeSelect(displayPath: string) {
  const original = store.nodes.find((n) => stripRoot(n.path) === displayPath);
  if (original) openFile(original.path);
}

async function refreshList() {
  listLoading.value = true;
  listError.value = null;
  try {
    await store.fetchList(props.id);
  } catch (err) {
    listError.value = (err as Error).message || 'Failed to load files';
  } finally {
    listLoading.value = false;
  }
}

async function openFile(path: string) {
  if (dirty.value) {
    if (!confirm('Unsaved changes will be lost. Continue?')) return;
  }
  selected.value = path;
  contentLoading.value = true;
  contentError.value = null;
  saveError.value = null;
  sheetOpen.value = false;
  try {
    const file = await store.fetchContent(props.id, path);
    original.value = file.content;
    content.value = file.content;
  } catch (err) {
    original.value = '';
    content.value = '';
    contentError.value = (err as Error).message || 'Failed to load file';
  } finally {
    contentLoading.value = false;
  }
}

async function onSave() {
  if (!selected.value || !dirty.value) return;
  saving.value = true;
  saveError.value = null;
  try {
    const updated = await store.save(props.id, selected.value, content.value);
    original.value = updated.content;
    content.value = updated.content;
  } catch (err) {
    saveError.value = (err as Error).message || 'Failed to save';
  } finally {
    saving.value = false;
  }
}

function pickFolder() {
  uploadError.value = null;
  folderInput.value?.click();
}

async function onFolderPicked(event: Event) {
  const input = event.target as HTMLInputElement;
  const fileList = input.files;
  if (!fileList || fileList.length === 0) return;

  const arr = Array.from(fileList);
  const ok = confirm(
    `Upload ${arr.length} file(s)? This will REPLACE all existing files for this template.`,
  );
  if (!ok) {
    input.value = '';
    return;
  }

  uploading.value = true;
  uploadError.value = null;
  try {
    await store.uploadFolder(props.id, arr);
    selected.value = null;
    original.value = '';
    content.value = '';
  } catch (err) {
    uploadError.value = (err as Error).message || 'Failed to upload';
  } finally {
    uploading.value = false;
    input.value = '';
  }
}

await useAsyncData(`admin-template-files-${props.id}`, async () => {
  await refreshList();
  return true;
});
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center justify-between gap-2 flex-wrap">
      <div class="flex items-center gap-2">
        <Sheet v-model:open="sheetOpen">
          <SheetTrigger as-child>
            <Button variant="outline" size="sm" class="md:hidden">
              <IconFiles class="size-4" />
              Files
            </Button>
          </SheetTrigger>
          <SheetContent side="left" class="w-[85vw] sm:max-w-sm">
            <SheetHeader>
              <SheetTitle>Files</SheetTitle>
            </SheetHeader>
            <div class="overflow-auto px-2 pb-4">
              <AgentFileTree
                :files="treeFiles"
                :selected="treeSelected"
                @select="onTreeSelect"
              />
            </div>
          </SheetContent>
        </Sheet>
        <p class="text-sm text-muted-foreground">
          {{ store.nodes.length }} files in
          <code class="text-xs">templates/{{ id }}/</code>
        </p>
      </div>
      <div class="flex items-center gap-2">
        <input
          ref="folderInput"
          type="file"
          class="hidden"
          multiple
          webkitdirectory
          directory
          @change="onFolderPicked"
        />
        <Button
          size="sm"
          variant="outline"
          :disabled="uploading"
          @click="pickFolder"
        >
          <IconUpload class="size-4" :class="uploading && 'animate-pulse'" />
          {{ uploading ? 'Uploading…' : 'Upload .agent folder' }}
        </Button>
        <Button
          variant="outline"
          size="sm"
          :disabled="listLoading"
          @click="refreshList"
        >
          <IconRefresh class="size-4" :class="listLoading && 'animate-spin'" />
        </Button>
      </div>
    </div>

    <p class="text-xs text-muted-foreground">
      Uploading a folder replaces all existing template files. Only
      <code>.md</code> and <code>.json</code> are editable in the browser.
    </p>

    <div
      v-if="listError"
      class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
    >
      {{ listError }}
    </div>
    <div
      v-if="uploadError"
      class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
    >
      {{ uploadError }}
    </div>

    <div class="grid gap-4 md:grid-cols-[280px_minmax(0,1fr)] md:items-start">
      <div class="hidden max-h-[640px] overflow-auto rounded-md border p-2 md:block">
        <AgentFileTree
          :files="treeFiles"
          :selected="treeSelected"
          @select="onTreeSelect"
        />
      </div>
      <div class="min-h-[480px]">
        <AgentFileViewer
          :path="selected"
          :content="content"
          :loading="contentLoading"
          :saving="saving"
          :load-error="contentError"
          :save-error="saveError"
          :dirty="dirty"
          @update:content="(v: string) => (content = v)"
          @save="onSave"
        />
      </div>
    </div>
  </div>
</template>
