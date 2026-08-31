<script setup lang="ts">
import {
  BridleAttachmentKinds,
  type IBridleAttachment,
} from '#bridle/stores/bridle';
import { formatBytes } from '#bridle/domain';

const props = defineProps<{
  attachments: IBridleAttachment[];
  /** Sent bubbles are the user's; colours invert against the primary fill. */
  onPrimary?: boolean;
}>();

/**
 * Attachments whose stored object has gone. Tracked per id so one dead file
 * renders as "no longer available" instead of a broken image icon, while its
 * siblings keep working.
 */
const missing = ref<Set<string>>(new Set());

function markMissing(id: string) {
  missing.value = new Set(missing.value).add(id);
}

const images = computed(() =>
  props.attachments.filter((a) => a.kind === BridleAttachmentKinds.Image),
);
const files = computed(() =>
  props.attachments.filter((a) => a.kind !== BridleAttachmentKinds.Image),
);

function iconFor(attachment: IBridleAttachment): string {
  return attachment.kind === BridleAttachmentKinds.Text ? 'file-text' : 'file';
}

function displayName(name: string): string {
  if (name.length <= 28) return name;
  return `${name.slice(0, 16)}…${name.slice(-9)}`;
}
</script>

<template>
  <div class="mb-2 flex flex-col gap-1.5">
    <!-- Images first, then files: the order every chat client uses -->
    <div
      v-if="images.length"
      class="flex flex-wrap gap-1.5"
    >
      <template
        v-for="image in images"
        :key="image.id"
      >
        <a
          v-if="!missing.has(image.id)"
          :href="image.url"
          target="_blank"
          rel="noopener"
          class="block overflow-hidden rounded-lg border border-black/10"
        >
          <img
            :src="image.url"
            :alt="image.name"
            class="max-h-48 max-w-full object-cover"
            @error="markMissing(image.id)"
          >
        </a>
        <div
          v-else
          class="flex items-center gap-1.5 rounded-lg border border-dashed px-2 py-1.5 text-[11px]"
          :class="onPrimary ? 'border-primary-foreground/40' : 'text-muted-foreground'"
        >
          <Icon
            name="image-off"
            :size="12"
          />
          <span>{{ $t('chat.attachment_unavailable') }}</span>
        </div>
      </template>
    </div>

    <a
      v-for="file in files"
      :key="file.id"
      :href="file.url"
      target="_blank"
      rel="noopener"
      class="flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs transition hover:opacity-80"
      :class="
        onPrimary
          ? 'border-primary-foreground/25 bg-primary-foreground/10'
          : 'bg-background/60'
      "
      :title="file.name"
    >
      <Icon
        :name="iconFor(file)"
        :size="14"
        class="shrink-0 opacity-70"
      />
      <span class="min-w-0 flex-1 truncate">{{ displayName(file.name) }}</span>
      <span class="shrink-0 text-[11px] opacity-60">
        {{ formatBytes(file.size) }}
      </span>
    </a>
  </div>
</template>
