<script setup lang="ts">
/**
 * The confirmation before an agent is deleted (CLEAN-228, research R11):
 * what will go, a backup of its files first if wanted, and the opt-in wipe of
 * what is stored for it. Moved here from the retired Edit page and used by
 * both ways in — the header menu and the Delete block on Overview.
 *
 * It deletes and says so (`deleted`); where the operator lands afterwards is
 * the caller's business.
 */
import {
  IconCheck,
  IconDownload,
  IconLoader2,
  IconTrash,
} from '@tabler/icons-vue'
import {
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
} from 'reka-ui'

const props = defineProps<{
  open: boolean
  agentId: string
  agentName: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  deleted: []
}>()

const agentStore = useAgentStore()
const fileStore = useAgentFileStore()

const isOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
})

const removing = ref(false)
const removeError = ref<string | null>(null)
// Opt-in S3 wipe. Off by default so an accidental Delete doesn't nuke
// files the operator might still want — the dialog also offers a
// pre-download for that case.
const wipeS3 = ref(false)

const downloading = ref(false)
const downloadError = ref<string | null>(null)

async function onDownload() {
  if (downloading.value) return
  downloading.value = true
  downloadError.value = null
  try {
    await fileStore.downloadZip(props.agentId)
  } catch (err) {
    downloadError.value = (err as Error).message || 'Download failed'
  } finally {
    downloading.value = false
  }
}

watch(
  () => props.open,
  (open) => {
    // Reset when it closes so the next open doesn't carry over a stale wipe
    // choice or a stale error.
    if (!open) {
      wipeS3.value = false
      downloadError.value = null
      removeError.value = null
    }
  },
)

function onCancel() {
  if (removing.value) return
  isOpen.value = false
}

async function onRemove() {
  if (removing.value) return
  removing.value = true
  removeError.value = null
  try {
    await agentStore.remove(props.agentId, { wipeS3: wipeS3.value })
    isOpen.value = false
    emit('deleted')
  } catch (err) {
    removeError.value = (err as Error).message || 'Delete failed'
  } finally {
    removing.value = false
  }
}
</script>

<template>
  <AlertDialogRoot v-model:open="isOpen">
    <AlertDialogPortal>
      <AlertDialogOverlay
        class="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/80 motion-reduce:animate-none"
      />
      <AlertDialogContent
        class="bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border p-6 shadow-lg duration-200 motion-reduce:animate-none"
        data-delete-dialog
      >
        <div class="flex flex-col gap-2 text-left">
          <AlertDialogTitle class="text-foreground text-lg font-semibold">
            Delete agent
          </AlertDialogTitle>
          <AlertDialogDescription class="text-muted-foreground text-sm break-words">
            Permanently delete agent “{{ agentName }}”? Pod, scenarios
            and evaluations will be removed. This cannot be undone.
          </AlertDialogDescription>
        </div>

        <div class="flex flex-col gap-3 rounded-md border bg-muted/30 p-3 text-sm">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="font-medium">Download a backup first</p>
              <p class="text-xs text-muted-foreground">
                ZIP of every file under
                <code class="font-mono text-xs break-all">agents/{{ agentId }}/</code>.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              :disabled="downloading"
              data-delete-download
              @click="onDownload"
            >
              <IconLoader2
                v-if="downloading"
                class="size-4 animate-spin motion-reduce:animate-none"
              />
              <IconDownload v-else class="size-4" />
              {{ downloading ? 'Downloading…' : 'Download' }}
            </Button>
          </div>
          <p v-if="downloadError" class="text-xs text-destructive" role="alert">
            {{ downloadError }}
          </p>
        </div>

        <label
          class="flex cursor-pointer items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          <input
            v-model="wipeS3"
            type="checkbox"
            class="mt-0.5 size-4 shrink-0 accent-destructive"
            :disabled="removing"
            data-delete-wipe
          />
          <span class="flex min-w-0 flex-col gap-1">
            <span class="font-medium">
              Also wipe S3 storage
              <IconCheck
                v-if="wipeS3"
                class="inline size-3 align-text-bottom text-destructive"
              />
            </span>
            <span class="text-xs text-muted-foreground">
              Drops every object under
              <code class="font-mono text-xs break-all">agents/{{ agentId }}/</code>.
              Without this, S3 data is preserved.
            </span>
          </span>
        </label>

        <p v-if="removeError" class="text-xs text-destructive" role="alert">
          {{ removeError }}
        </p>

        <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" :disabled="removing" @click="onCancel">
            Cancel
          </Button>
          <Button
            variant="destructive"
            :disabled="removing"
            data-delete-confirm
            @click="onRemove"
          >
            <IconLoader2
              v-if="removing"
              class="size-4 animate-spin motion-reduce:animate-none"
            />
            <IconTrash v-else class="size-4" />
            {{ removing
              ? 'Deleting…'
              : wipeS3
                ? 'Delete agent + wipe S3'
                : 'Delete agent' }}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>
