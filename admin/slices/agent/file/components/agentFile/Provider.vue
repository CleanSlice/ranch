<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '#theme/components/ui/sheet';
import { IconFiles, IconRefresh } from '@tabler/icons-vue';
import AgentFileTree from './Tree.vue';
import AgentFileViewer from './Viewer.vue';

const props = defineProps<{ id: string }>();

const store = useAgentFileStore();

const listLoading = ref(false);
const listError = ref<string | null>(null);

const selected = ref<string | null>(null);
const original = ref<string>('');
const content = ref<string>('');

const contentLoading = ref(false);
const contentError = ref<string | null>(null);

const saving = ref(false);
const saveError = ref<string | null>(null);

const sheetOpen = ref(false);

const dirty = computed(() => content.value !== original.value);

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

await useAsyncData(`admin-agent-files-${props.id}`, async () => {
  await refreshList();
  return true;
});
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center justify-between gap-2">
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
                :files="store.nodes"
                :selected="selected"
                @select="openFile"
              />
            </div>
          </SheetContent>
        </Sheet>
        <p class="text-sm text-muted-foreground">
          {{ store.nodes.length }} files
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        :disabled="listLoading"
        @click="refreshList"
      >
        <IconRefresh class="size-4" :class="listLoading && 'animate-spin'" />
      </Button>
    </div>

    <div
      v-if="listError"
      class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
    >
      {{ listError }}
    </div>

    <div class="grid gap-4 md:grid-cols-[280px_minmax(0,1fr)] md:items-start">
      <div class="hidden max-h-[640px] overflow-auto rounded-md border p-2 md:block">
        <AgentFileTree
          :files="store.nodes"
          :selected="selected"
          @select="openFile"
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
