<script setup lang="ts">
import {
  BridleAttachmentKinds,
  type IBridleAttachment,
} from '#bridle/stores/bridle';
import { formatBytes } from '#bridle/domain';

const props = defineProps<{
  attachments: IBridleAttachment[];
  agentId: string;
  /** Sent bubbles are the user's; colours invert against the primary fill. */
  onPrimary?: boolean;
}>();

const bridleStore = useBridleStore();

/**
 * The download route is behind the JWT guard, and a browser sends no
 * Authorization header for `<img src>` or a plain `<a href>` — pointing either
 * at the API URL renders a broken image and a 401 on click. So the bytes are
 * fetched through the API client and handed to the DOM as object URLs.
 *
 * Keyed by attachment id, and revoked on unmount: a conversation with a dozen
 * screenshots would otherwise pin every one of them in memory for the life of
 * the tab.
 */
const objectUrls = ref<Record<string, string>>({});

/**
 * Attachments whose stored object has gone. Tracked per id so one dead file
 * renders as "no longer available" instead of a broken image icon, while its
 * siblings keep working.
 */
const missing = ref<Set<string>>(new Set());

function markMissing(id: string) {
  missing.value = new Set(missing.value).add(id);
}

async function resolve(attachment: IBridleAttachment) {
  if (objectUrls.value[attachment.id] || missing.value.has(attachment.id)) {
    return;
  }
  try {
    const blob = await bridleStore.fetchAttachment(props.agentId, attachment.id);
    objectUrls.value = {
      ...objectUrls.value,
      [attachment.id]: URL.createObjectURL(blob),
    };
  } catch {
    markMissing(attachment.id);
  }
}

function revokeAll() {
  for (const url of Object.values(objectUrls.value)) URL.revokeObjectURL(url);
  objectUrls.value = {};
}

watch(
  () => props.attachments,
  (attachments) => {
    for (const attachment of attachments) void resolve(attachment);
  },
  { immediate: true, deep: true },
);

onBeforeUnmount(revokeAll);

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
          v-if="objectUrls[image.id]"
          :href="objectUrls[image.id]"
          target="_blank"
          rel="noopener"
          class="block overflow-hidden rounded-lg border border-black/10"
        >
          <img
            :src="objectUrls[image.id]"
            :alt="image.name"
            class="max-h-48 max-w-full object-cover"
          >
        </a>
        <div
          v-else-if="missing.has(image.id)"
          class="flex items-center gap-1.5 rounded-lg border border-dashed px-2 py-1.5 text-[11px]"
          :class="onPrimary ? 'border-primary-foreground/40' : 'text-muted-foreground'"
        >
          <Icon
            name="image-off"
            :size="12"
          />
          <span>{{ $t('chat.attachment_unavailable') }}</span>
        </div>
        <!-- Placeholder sized like a small thumbnail, so the bubble doesn't
             resize under the reader once the bytes land. -->
        <div
          v-else
          class="h-24 w-32 animate-pulse rounded-lg bg-muted"
        />
      </template>
    </div>

    <component
      :is="objectUrls[file.id] ? 'a' : 'div'"
      v-for="file in files"
      :key="file.id"
      :href="objectUrls[file.id]"
      :download="objectUrls[file.id] ? file.name : undefined"
      class="flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs transition"
      :class="[
        onPrimary
          ? 'border-primary-foreground/25 bg-primary-foreground/10'
          : 'bg-background/60',
        objectUrls[file.id] ? 'hover:opacity-80' : 'opacity-60',
      ]"
      :title="missing.has(file.id) ? $t('chat.attachment_unavailable') : file.name"
    >
      <Icon
        :name="missing.has(file.id) ? 'ban' : iconFor(file)"
        :size="14"
        class="shrink-0 opacity-70"
      />
      <span class="min-w-0 flex-1 truncate">{{ displayName(file.name) }}</span>
      <span class="shrink-0 text-[11px] opacity-60">
        {{ formatBytes(file.size) }}
      </span>
    </component>
  </div>
</template>
