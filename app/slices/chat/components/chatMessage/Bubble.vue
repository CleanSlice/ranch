<script setup lang="ts">
import { renderMarkdown } from '#bridle/utils/markdown';
import type { IChatMessage } from '#chat/stores/chat';

// Read-only transcript message. Renders one persisted event by role: user /
// assistant bubbles, plus a collapsible marker for `summary` events (where
// compaction folded older turns into a gist). Tool events never reach the app.
const props = defineProps<{ message: IChatMessage }>();

const isUser = computed(() => props.message.role === 'user');

// Assistant text may contain markdown; user text stays plain (typed by a human,
// don't HTML-render pasted content).
const html = computed(() =>
  isUser.value ? null : renderMarkdown(props.message.text),
);

const summaryOpen = ref(false);
// Compaction wraps the archive in [ARCHIVED CONTEXT …] markers — strip them so
// the plain gist shows.
const summaryText = computed(() =>
  props.message.text
    .replace(/^\[ARCHIVED CONTEXT[^\]]*\]\s*/i, '')
    .replace(/\s*\[END ARCHIVED CONTEXT\]\s*$/i, '')
    .trim(),
);
</script>

<template>
  <!-- Summary marker: compaction folded older turns into a gist -->
  <div v-if="message.role === 'summary'" class="my-1 flex justify-center">
    <div
      class="w-full max-w-2xl rounded-md border border-dashed bg-muted/40 px-3 py-2 text-sm"
    >
      <button
        type="button"
        class="flex w-full items-center gap-2 text-left text-muted-foreground"
        @click="summaryOpen = !summaryOpen"
      >
        <Icon name="file-text" :size="14" class="shrink-0" />
        <span class="font-medium">Earlier in this conversation — summarized</span>
        <span class="ml-auto text-xs">{{ summaryOpen ? 'Hide' : 'Show' }}</span>
      </button>
      <p
        v-if="summaryOpen"
        class="mt-2 whitespace-pre-wrap text-muted-foreground"
      >
        {{ summaryText }}
      </p>
    </div>
  </div>

  <!-- User / assistant bubble -->
  <div
    v-else
    class="flex items-start gap-2"
    :class="isUser ? 'flex-row-reverse' : 'flex-row'"
  >
    <div
      class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
      :class="
        isUser
          ? 'bg-primary text-primary-foreground'
          : 'bg-linear-to-br from-primary/25 to-primary/5 text-primary'
      "
    >
      <Icon :name="isUser ? 'user' : 'bot'" :size="15" />
    </div>
    <div
      class="max-w-[85%] sm:max-w-[75%] wrap-break-word rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm"
      :class="
        isUser
          ? 'whitespace-pre-wrap rounded-br-md bg-primary text-primary-foreground'
          : 'chat-md rounded-tl-md bg-muted text-foreground'
      "
    >
      <template v-if="isUser">{{ message.text }}</template>
      <div v-else v-html="html" />
    </div>
  </div>
</template>

<style>
/* Markdown inside an assistant bubble (global so v-html children pick it up). */
.chat-md > *:first-child {
  margin-top: 0;
}
.chat-md > *:last-child {
  margin-bottom: 0;
}
.chat-md p {
  margin: 0.4em 0;
}
.chat-md p:empty {
  display: none;
}
.chat-md strong {
  font-weight: 600;
}
.chat-md em {
  font-style: italic;
}
.chat-md a {
  color: var(--color-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.chat-md a:hover {
  opacity: 0.85;
}
.chat-md ul,
.chat-md ol {
  margin: 0.5em 0;
  padding-left: 1.4em;
}
.chat-md ul {
  list-style: disc;
}
.chat-md ol {
  list-style: decimal;
}
.chat-md li {
  margin: 0.2em 0;
}
.chat-md li > p {
  margin: 0;
}
.chat-md h1,
.chat-md h2,
.chat-md h3,
.chat-md h4,
.chat-md h5,
.chat-md h6 {
  font-weight: 600;
  line-height: 1.3;
  margin: 0.8em 0 0.3em;
}
.chat-md h1 {
  font-size: 1.15em;
}
.chat-md h2 {
  font-size: 1.05em;
}
.chat-md code {
  background-color: color-mix(in srgb, currentColor 10%, transparent);
  padding: 0.1em 0.35em;
  border-radius: 0.25rem;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
  font-size: 0.9em;
}
.chat-md pre {
  background-color: color-mix(in srgb, currentColor 8%, transparent);
  border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  border-radius: 0.5rem;
  padding: 0.75em 0.9em;
  overflow-x: auto;
  margin: 0.6em 0;
  font-size: 0.85em;
  line-height: 1.5;
}
.chat-md pre code {
  background: transparent;
  padding: 0;
  border-radius: 0;
  font-size: inherit;
}
.chat-md blockquote {
  border-left: 3px solid color-mix(in srgb, currentColor 25%, transparent);
  padding-left: 0.9em;
  margin: 0.5em 0;
  color: var(--color-muted-foreground);
  font-style: italic;
}
</style>
