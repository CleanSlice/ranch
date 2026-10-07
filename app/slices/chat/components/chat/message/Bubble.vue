<script setup lang="ts">
import BridleChatSources from '#bridle/components/bridle/chat/Sources.vue';
import { citationNumberOf } from '#bridle/utils/citations';
import { renderMarkdown } from '#bridle/utils/markdown';
import type { IChatMessage } from '#chat/stores/chat';
import { formatMessageTime } from '#chat/utils/transcript';
import { useFormat } from '#common/composables/useFormat';

// The agent's chip, the bubble and the markdown rules are Bridle's own
// (CLEAN-137): a message in the history is the same message the live chat
// showed, so it is drawn by the same code.
//
// Read-only transcript message. Renders one persisted event by role: user /
// assistant bubbles, plus a collapsible marker for `summary` events (where
// compaction folded older turns into a gist). Tool events never reach the app.
// `rating` is the current user's 👍/👎 on this assistant message (1 | -1 | null).
const props = defineProps<{ message: IChatMessage; rating?: number | null }>();
const emit = defineEmits<{
  rate: [rating: 1 | -1];
  /** A cited knowledge document the reader may open (CLEAN-138). */
  openSource: [n: number];
  /** A verdict on a cited knowledge source; `null` withdraws it. */
  rateSource: [n: number, rating: 1 | -1 | null];
}>();

const { locale, t } = useI18n();
const format = useFormat();

const isUser = computed(() => props.message.role === 'user');

// Assistant text may contain markdown; user text stays plain (typed by a human,
// don't HTML-render pasted content). History is never streaming, so citation
// chips (CLEAN-138) carry their numbers straight away.
const html = computed(() =>
  isUser.value
    ? null
    : renderMarkdown(props.message.text, { citations: 'numbered' }),
);

const sourcesList = ref<{ reveal: (n: number) => void } | null>(null);
function onBubbleClick(event: Event) {
  const n = citationNumberOf(event.target);
  if (n !== null) sourcesList.value?.reveal(n);
}
function onBubbleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const n = citationNumberOf(event.target);
  if (n === null) return;
  event.preventDefault();
  sourcesList.value?.reveal(n);
}
const time = computed(() => formatMessageTime(props.message.ts, locale.value));

const summaryOpen = ref(false);
// Compaction wraps the archive in [ARCHIVED CONTEXT …] markers — strip them so
// the plain gist shows.
const summaryText = computed(() =>
  props.message.text
    .replace(/^\[ARCHIVED CONTEXT[^\]]*\]\s*/i, '')
    .replace(/\s*\[END ARCHIVED CONTEXT\]\s*$/i, '')
    .trim(),
);

const copied = ref(false);
function onCopy() {
  navigator.clipboard
    .writeText(props.message.text)
    .then(() => {
      copied.value = true;
      setTimeout(() => (copied.value = false), 1500);
    })
    .catch(() => {});
}
</script>

<template>
  <!-- Summary marker: compaction folded older turns into a gist -->
  <div v-if="message.role === 'summary'" class="my-1 flex justify-center">
    <div
      class="w-full rounded-xl border border-dashed bg-muted/30 px-3 py-2 text-sm"
    >
      <button
        type="button"
        class="flex w-full items-center gap-2 text-left text-muted-foreground"
        @click="summaryOpen = !summaryOpen"
      >
        <Icon name="file-text" :size="14" class="shrink-0" />
        <span class="font-medium">{{ $t('message.summarized') }}</span>
        <span class="ml-auto text-xs">
          {{ $t(summaryOpen ? 'message.hide' : 'message.show') }}
        </span>
      </button>
      <p
        v-if="summaryOpen"
        class="mt-2 whitespace-pre-wrap text-muted-foreground"
      >
        {{ summaryText }}
      </p>
    </div>
  </div>

  <!-- User message: the live chat's bubble on the right, time below. Files
       the person sent are named above the text; their contents never render
       here. -->
  <div v-else-if="isUser" class="flex items-start justify-end gap-2">
    <div class="flex min-w-0 max-w-[85%] flex-col items-end gap-1 sm:max-w-[75%]">
      <BridleChatBubble user>
        <div
          v-if="message.attachments?.length"
          class="mb-1.5 flex flex-wrap gap-1.5"
        >
          <span
            v-for="file in message.attachments"
            :key="file.id"
            :title="$t('message.attached_file_detail', { name: file.name, size: format.size(file.size) })"
            class="inline-flex max-w-full items-center gap-1 rounded border border-primary-foreground/30 px-1.5 py-0.5 text-xs"
          >
            <Icon name="paperclip" :size="12" class="shrink-0" />
            <span class="truncate">{{ file.name }}</span>
          </span>
        </div>
        <template v-if="message.text">{{ message.text }}</template>
      </BridleChatBubble>
      <span class="px-1 text-[11px] text-muted-foreground">{{ time }}</span>
    </div>
  </div>

  <!-- Assistant: the live chat's chip and bubble, actions row below -->
  <div v-else class="flex items-start justify-start gap-2">
    <BridleChatAvatar />
    <div class="flex min-w-0 max-w-[85%] flex-col items-start gap-1 sm:max-w-[75%]">
      <BridleChatBubble>
        <div @click="onBubbleClick" @keydown="onBubbleKeydown" v-html="html" />
      </BridleChatBubble>

      <!-- What the answer drew on (CLEAN-138) — the live chat's own list. -->
      <BridleChatSources
        v-if="message.sources?.length"
        ref="sourcesList"
        :sources="message.sources"
        :message-id="message.id"
        @open="(n) => emit('openSource', n)"
        @rate="(n, r) => emit('rateSource', n, r)"
      />

      <div class="flex items-center gap-2 px-1">
        <span class="text-[11px] text-muted-foreground">{{ time }}</span>
        <button
          type="button"
          :aria-label="$t('message.helpful')"
          class="rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-foreground"
          :class="rating === 1 && 'text-emerald-600'"
          @click="emit('rate', 1)"
        >
          <Icon name="thumbs-up" :size="14" />
        </button>
        <button
          type="button"
          :aria-label="$t('message.not_helpful')"
          class="rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-foreground"
          :class="rating === -1 && 'text-rose-600'"
          @click="emit('rate', -1)"
        >
          <Icon name="thumbs-down" :size="14" />
        </button>
        <button
          type="button"
          class="text-[11px] text-muted-foreground/60 transition-colors hover:text-foreground"
          @click="onCopy"
        >
          {{ t(copied ? 'message.copied' : 'message.copy') }}
        </button>
      </div>
    </div>
  </div>
</template>
