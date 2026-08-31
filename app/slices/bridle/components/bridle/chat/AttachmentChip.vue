<script setup lang="ts">
import {
  BridleAttachmentKinds,
  BridleAttachmentStates,
  type IBridleStagedAttachment,
} from '#bridle/stores/bridle';
import { formatBytes } from '#bridle/domain';

const props = defineProps<{ attachment: IBridleStagedAttachment }>();
const emit = defineEmits<{
  remove: [localId: string];
  retry: [localId: string];
}>();

const isImage = computed(
  () => props.attachment.kind === BridleAttachmentKinds.Image,
);
const isUploading = computed(
  () => props.attachment.state === BridleAttachmentStates.Uploading,
);
const isFailed = computed(
  () => props.attachment.state === BridleAttachmentStates.Failed,
);

// The agent reads images and text; a binary arrives as a name and a link.
// Saying so on the chip is the whole point — otherwise the only clue is a
// reply that talks around the file.
const notReadable = computed(
  () =>
    props.attachment.kind === BridleAttachmentKinds.Binary &&
    !isFailed.value &&
    !isUploading.value,
);

const icon = computed(() => {
  switch (props.attachment.kind) {
    case BridleAttachmentKinds.Image:
      return 'image';
    case BridleAttachmentKinds.Text:
      return 'file-text';
    default:
      return 'file';
  }
});

/**
 * Truncate in the middle so the extension survives — "quarterly-report…f.pdf"
 * tells you more than a name cut off before its type.
 */
const displayName = computed(() => {
  const name = props.attachment.name;
  if (name.length <= 24) return name;
  return `${name.slice(0, 14)}…${name.slice(-8)}`;
});
</script>

<template>
  <div
    class="group relative flex items-center gap-2 rounded-xl border bg-background/80 py-1.5 pl-1.5 pr-8 shadow-sm transition"
    :class="isFailed && 'border-destructive/50 bg-destructive/5'"
  >
    <!-- Thumbnail for images, kind icon for everything else -->
    <div
      class="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted"
    >
      <img
        v-if="isImage && attachment.previewUrl"
        :src="attachment.previewUrl"
        :alt="attachment.name"
        class="h-full w-full object-cover"
      >
      <Icon
        v-else
        :name="icon"
        :size="16"
        class="text-muted-foreground"
      />
    </div>

    <div class="min-w-0 flex-1">
      <p
        class="truncate text-xs font-medium"
        :title="attachment.name"
      >
        {{ displayName }}
      </p>

      <p
        v-if="isFailed && attachment.error"
        class="text-[11px] text-destructive"
      >
        {{ $t(attachment.error.key, attachment.error.params ?? {}) }}
      </p>
      <p
        v-else-if="isUploading"
        class="text-[11px] text-muted-foreground"
      >
        {{ $t('chat.attachment_uploading', { name: '' }) }} {{ attachment.progress }}%
      </p>
      <p
        v-else-if="notReadable"
        class="text-[11px] text-muted-foreground/80"
        :title="$t('chat.attachment_not_readable')"
      >
        {{ $t('chat.attachment_not_readable') }}
      </p>
      <p
        v-else
        class="text-[11px] text-muted-foreground"
      >
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
        :aria-label="$t('chat.attachment_uploading', { name: attachment.name })"
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
      class="absolute right-6 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
      :aria-label="$t('chat.attachment_retry', { name: attachment.name })"
      @click="emit('retry', attachment.localId)"
    >
      <Icon
        name="rotate-cw"
        :size="12"
      />
    </button>

    <button
      type="button"
      class="absolute right-1 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
      :aria-label="$t('chat.attachment_remove', { name: attachment.name })"
      @click="emit('remove', attachment.localId)"
    >
      <Icon
        name="x"
        :size="12"
      />
    </button>
  </div>
</template>
