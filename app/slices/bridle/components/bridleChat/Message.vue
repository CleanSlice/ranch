<script setup lang="ts">
import { BridleRoleTypes, type IBridleMessage } from '#bridle/stores/bridle';
import { renderMarkdown } from '#bridle/utils/markdown';

const props = defineProps<{
  message: IBridleMessage;
  agentName?: string;
}>();

const isUser = computed(() => props.message.role === BridleRoleTypes.User);

const agentInitial = computed(() => {
  const source = props.agentName?.trim() || 'Agent';
  const first = source.split(/\s+/).filter(Boolean)[0]?.[0];
  return first?.toUpperCase() ?? 'A';
});

// Agent messages can contain markdown (lists, headings, code). User messages
// stay plain text — they're typed by humans and we don't want to risk
// accidentally HTML-rendering something they pasted.
const renderedHtml = computed(() =>
  isUser.value ? null : renderMarkdown(props.message.text),
);
</script>

<template>
  <div
    class="flex items-start gap-2"
    :class="isUser ? 'justify-end' : 'justify-start'"
  >
    <div
      v-if="!isUser"
      class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-primary/25 to-primary/5 text-[11px] font-semibold text-primary"
      :title="agentName"
    >
      {{ agentInitial }}
    </div>

    <div
      class="max-w-[85%] sm:max-w-[75%] wrap-break-word px-4 py-2.5 text-sm leading-relaxed shadow-sm"
      :class="
        isUser
          ? 'whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary text-primary-foreground'
          : 'chat-md rounded-2xl rounded-tl-md bg-muted text-foreground'
      "
    >
      <template v-if="isUser">{{ message.text }}</template>
      <div v-else v-html="renderedHtml" />
    </div>
  </div>
</template>

<style>
/**
 * Markdown content rendered inside an agent bubble. Kept tight so headings,
 * lists, and code blocks read as part of the conversation rather than a
 * full article. Global (un-scoped) so v-html children pick it up.
 */
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
.chat-md li::marker {
  color: var(--color-muted-foreground);
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
.chat-md h3,
.chat-md h4,
.chat-md h5,
.chat-md h6 {
  font-size: 1em;
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

.chat-md hr {
  border: 0;
  border-top: 1px solid color-mix(in srgb, currentColor 15%, transparent);
  margin: 0.8em 0;
}

.chat-md table {
  border-collapse: collapse;
  margin: 0.5em 0;
  font-size: 0.9em;
  width: 100%;
}
.chat-md th,
.chat-md td {
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  padding: 0.35em 0.6em;
  text-align: left;
}
.chat-md th {
  font-weight: 600;
  background-color: color-mix(in srgb, currentColor 6%, transparent);
}
</style>
