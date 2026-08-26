<script setup lang="ts">
import { renderMarkdown } from '#bridle/utils/markdown';
import { Bot, FileText, ThumbsUp, ThumbsDown } from 'lucide-vue-next';
import type { IChatMessage } from '#chat/stores/chat';
import { formatMessageTime, type IToolEvent } from '#chat/utils/transcript';

// Read-only transcript message in the redesigned feed. Tool events arrive
// pre-grouped (see groupTranscript) and render as collapsible rows attached
// above the assistant reply they belong to.
// `rating` is the current user's 👍/👎 on this message (1 | -1 | null).
const props = defineProps<{
  message: IChatMessage;
  tools?: IToolEvent[];
  rating?: number | null;
}>();
const emit = defineEmits<{ rate: [rating: 1 | -1] }>();

const role = computed(() => props.message.role);
const isUser = computed(() => role.value === 'user');
const html = computed(() => renderMarkdown(props.message.text));
const time = computed(() => formatMessageTime(props.message.ts));

const summaryOpen = ref(false);
// Compaction stores the archive wrapped in [ARCHIVED CONTEXT …] markers — strip
// them for display; the plain gist is what the reader wants.
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

function onMarkdownClick(event: MouseEvent) {
  const btn = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
    'button[data-action="copy"]',
  );
  if (!btn) return;
  const text = btn.parentElement?.querySelector('pre')?.textContent ?? '';
  if (!text) return;
  navigator.clipboard
    .writeText(text)
    .then(() => {
      btn.classList.add('copied');
      setTimeout(() => btn.classList.remove('copied'), 1500);
    })
    .catch(() => {});
}
</script>

<template>
  <!-- Summary marker: compaction folded older turns into a gist -->
  <div v-if="role === 'summary'" class="my-1 flex justify-center">
    <div class="w-full rounded-xl border border-dashed bg-muted/30 px-3 py-2 text-sm">
      <button
        type="button"
        class="flex w-full items-center gap-2 text-left text-muted-foreground"
        @click="summaryOpen = !summaryOpen"
      >
        <FileText class="size-3.5 shrink-0" />
        <span class="font-medium">Earlier in this conversation — summarized</span>
        <span class="ml-auto text-xs">{{ summaryOpen ? 'Hide' : 'Show' }}</span>
      </button>
      <p v-if="summaryOpen" class="mt-2 whitespace-pre-wrap text-muted-foreground">
        {{ summaryText }}
      </p>
    </div>
  </div>

  <!-- System note -->
  <div v-else-if="role === 'system'" class="my-1 text-center text-xs text-muted-foreground">
    {{ message.text }}
  </div>

  <!-- User message: dark bubble on the right, time below -->
  <div v-else-if="isUser" class="flex flex-col items-end">
    <div
      class="max-w-[72%] whitespace-pre-wrap wrap-break-word rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground"
    >
      {{ message.text }}
    </div>
    <span class="mt-1 text-[11px] text-muted-foreground/60">{{ time }}</span>
  </div>

  <!-- Assistant: avatar chip, attached tool rows, bordered bubble, actions row -->
  <div v-else class="flex items-start gap-2.5">
    <div
      class="mt-0.5 flex size-6.5 shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground"
    >
      <Bot class="size-3.5" />
    </div>
    <div class="flex min-w-0 max-w-[82%] flex-col gap-1.5">
      <ChatMessageToolEvents v-if="tools?.length" :tools="tools" />

      <div
        class="rounded-2xl rounded-tl-sm border border-border/70 bg-card px-4 py-3 text-sm leading-relaxed"
      >
        <div
          class="prose prose-sm max-w-none dark:prose-invert wrap-break-word"
          v-html="html"
          @click="onMarkdownClick"
        />
      </div>

      <div class="flex items-center gap-2 pl-1">
        <span class="text-[11px] text-muted-foreground/60">{{ time }}</span>
        <button
          type="button"
          aria-label="Helpful"
          :class="
            cn(
              'rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-foreground',
              rating === 1 && 'text-green-600',
            )
          "
          @click="emit('rate', 1)"
        >
          <ThumbsUp class="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Not helpful"
          :class="
            cn(
              'rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-foreground',
              rating === -1 && 'text-red-600',
            )
          "
          @click="emit('rate', -1)"
        >
          <ThumbsDown class="size-3.5" />
        </button>
        <button
          type="button"
          class="text-[11px] text-muted-foreground/60 transition-colors hover:text-foreground"
          @click="onCopy"
        >
          {{ copied ? 'Copied' : 'Copy' }}
        </button>
      </div>
    </div>
  </div>
</template>
