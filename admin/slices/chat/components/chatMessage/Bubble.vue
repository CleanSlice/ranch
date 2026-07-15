<script setup lang="ts">
import { renderMarkdown } from '#bridle/utils/markdown';
import { cn } from '#theme/utils/cn';
import { User, Bot, Wrench, FileText } from 'lucide-vue-next';
import type { IChatMessage } from '#chat/stores/chat';

// Read-only transcript message. Unlike the bridle widget's Message.vue (coupled
// to live parts / streaming / debug inspect), this renders a single persisted
// event by role: user/assistant bubbles, a collapsible summary marker for
// compacted history, and compact tool_call/tool_result blocks for the debug view.
const props = defineProps<{ message: IChatMessage }>();

const role = computed(() => props.message.role);
const isUser = computed(() => role.value === 'user');
const html = computed(() => renderMarkdown(props.message.text));

const summaryOpen = ref(false);
// Compaction stores the archive wrapped in [ARCHIVED CONTEXT …] markers — strip
// them for display; the plain gist is what the reader wants.
const summaryText = computed(() =>
  props.message.text
    .replace(/^\[ARCHIVED CONTEXT[^\]]*\]\s*/i, '')
    .replace(/\s*\[END ARCHIVED CONTEXT\]\s*$/i, '')
    .trim(),
);

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
  <div v-if="role === 'summary'" class="my-2 flex justify-center">
    <div class="w-full max-w-2xl rounded-md border border-dashed bg-muted/40 px-3 py-2 text-sm">
      <button
        type="button"
        class="flex w-full items-center gap-2 text-left text-muted-foreground"
        @click="summaryOpen = !summaryOpen"
      >
        <FileText class="size-3.5 shrink-0" />
        <span class="font-medium">Earlier in this conversation — summarized</span>
        <span class="ml-auto text-xs">{{ summaryOpen ? 'Hide' : 'Show' }}</span>
      </button>
      <p v-if="summaryOpen" class="mt-2 whitespace-pre-wrap text-muted-foreground">{{ summaryText }}</p>
    </div>
  </div>

  <!-- Tool events (debug view) -->
  <div v-else-if="role === 'tool_call' || role === 'tool_result'" class="my-1 flex justify-center">
    <div class="w-full max-w-2xl rounded-md border bg-muted/30 px-3 py-2 font-mono text-xs">
      <div class="mb-1 flex items-center gap-1.5 text-muted-foreground">
        <Wrench class="size-3" />
        <span>{{ role === 'tool_call' ? 'tool call' : 'tool result' }}</span>
      </div>
      <pre class="overflow-x-auto whitespace-pre-wrap wrap-break-word">{{ message.text }}</pre>
    </div>
  </div>

  <!-- System note -->
  <div v-else-if="role === 'system'" class="my-1 text-center text-xs text-muted-foreground">
    {{ message.text }}
  </div>

  <!-- User / assistant bubble -->
  <div
    v-else
    :class="cn('flex w-full items-start gap-2', isUser ? 'flex-row-reverse' : 'flex-row')"
  >
    <div
      :class="
        cn(
          'flex size-7 shrink-0 items-center justify-center rounded-full',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
        )
      "
    >
      <User v-if="isUser" class="size-4" />
      <Bot v-else class="size-4" />
    </div>
    <div
      :class="
        cn(
          'min-w-0 max-w-[80%] rounded-lg px-3 py-2 text-sm',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted',
        )
      "
    >
      <p v-if="isUser" class="whitespace-pre-wrap wrap-break-word">{{ message.text }}</p>
      <div v-else class="prose prose-sm max-w-none dark:prose-invert wrap-break-word" v-html="html" @click="onMarkdownClick" />
    </div>
  </div>
</template>
