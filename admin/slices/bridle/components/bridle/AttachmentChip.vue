<script setup lang="ts">
import { computed } from 'vue'
import { FileText, Image as ImageIcon, File as FileIcon, RotateCw, X } from 'lucide-vue-next'
import {
  BridleAttachmentKinds,
  BridleAttachmentStates,
  formatBytes,
  isReadableByAgent,
  type IStagedAttachment,
} from '../../utils/attachment'
import { cn } from '#theme/utils/cn'

const props = defineProps<{ attachment: IStagedAttachment }>()

defineEmits<{
  remove: [localId: string]
  retry: [localId: string]
}>()

const isImage = computed(() => props.attachment.kind === BridleAttachmentKinds.Image)
const isUploading = computed(
  () => props.attachment.state === BridleAttachmentStates.Uploading,
)
const isFailed = computed(
  () => props.attachment.state === BridleAttachmentStates.Failed,
)

// The agent reads images, text, and server-extracted documents; anything
// else arrives as a name and a link. Saying so on the chip is the whole
// point — otherwise the only clue is a reply that talks around the file.
const notReadable = computed(
  () =>
    !isReadableByAgent(props.attachment.kind, props.attachment.mimeType) &&
    !isFailed.value &&
    !isUploading.value,
)

const KindIcon = computed(() => {
  if (props.attachment.kind === BridleAttachmentKinds.Image) return ImageIcon
  if (props.attachment.kind === BridleAttachmentKinds.Text) return FileText
  return FileIcon
})

/**
 * Truncate in the middle so the extension survives — "quarterly-report…f.pdf"
 * tells you more than a name cut off before its type.
 */
const displayName = computed(() => {
  const name = props.attachment.name
  if (name.length <= 24) return name
  return `${name.slice(0, 14)}…${name.slice(-8)}`
})
</script>

<template>
  <div
    :class="cn(
      'relative flex items-center gap-2 rounded-lg border bg-background py-1.5 pl-1.5 pr-8 shadow-sm',
      isFailed && 'border-destructive/50 bg-destructive/5',
    )"
  >
    <!-- Thumbnail for images, kind icon for everything else -->
    <div class="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
      <img
        v-if="isImage && attachment.previewUrl"
        :src="attachment.previewUrl"
        :alt="attachment.name"
        class="h-full w-full object-cover"
      >
      <component :is="KindIcon" v-else class="h-4 w-4 text-muted-foreground" />
    </div>

    <div class="min-w-0 flex-1">
      <p class="truncate text-xs font-medium" :title="attachment.name">
        {{ displayName }}
      </p>

      <p v-if="isFailed" class="text-[11px] text-destructive">
        {{ attachment.error ?? 'Upload failed' }}
      </p>
      <p v-else-if="isUploading" class="text-[11px] text-muted-foreground">
        Uploading {{ attachment.progress }}%
      </p>
      <p
        v-else-if="notReadable"
        class="text-[11px] text-muted-foreground/80"
        title="The agent sees the name, not the contents"
      >
        The agent sees the name, not the contents
      </p>
      <p v-else class="text-[11px] text-muted-foreground">
        {{ formatBytes(attachment.size) }}
      </p>

      <!-- Determinate progress: a large file should never look like a hang -->
      <div
        v-if="isUploading"
        class="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        :aria-valuenow="attachment.progress"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="`Uploading ${attachment.name}`"
      >
        <div
          class="h-full bg-primary transition-all"
          :style="{ width: `${attachment.progress}%` }"
        />
      </div>
    </div>

    <button
      v-if="isFailed"
      type="button"
      class="absolute right-6 top-1.5 inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
      :aria-label="`Retry ${attachment.name}`"
      :title="`Retry ${attachment.name}`"
      @click="$emit('retry', attachment.localId)"
    >
      <RotateCw class="h-3 w-3" />
    </button>

    <button
      type="button"
      class="absolute right-1 top-1.5 inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
      :aria-label="`Remove ${attachment.name}`"
      :title="`Remove ${attachment.name}`"
      @click="$emit('remove', attachment.localId)"
    >
      <X class="h-3 w-3" />
    </button>
  </div>
</template>
