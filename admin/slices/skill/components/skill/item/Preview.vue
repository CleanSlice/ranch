<script setup lang="ts">
import { watchDebounced } from '@vueuse/core';
import { renderMarkdown } from '#bridle/utils/markdown';

/**
 * "What the agent reads": the body through the same markdown renderer and
 * sanitiser the chat uses (CLEAN-205, research R11). Re-rendered 200 ms
 * after the last keystroke so a long body never fights the editor.
 */
const props = defineProps<{ body: string }>();

const html = ref(renderMarkdown(props.body));
watchDebounced(
  () => props.body,
  (body) => {
    html.value = renderMarkdown(body);
  },
  { debounce: 200, maxWait: 1000 },
);
</script>

<template>
  <div data-skill-preview="markdown" class="rounded-lg border bg-card p-4">
    <!-- eslint-disable-next-line vue/no-v-html -- sanitised by renderMarkdown -->
    <div v-if="body.trim()" class="chat-md text-sm" v-html="html" />
    <p v-else class="text-sm text-muted-foreground">Start writing the body to see it rendered here.</p>
  </div>
</template>
