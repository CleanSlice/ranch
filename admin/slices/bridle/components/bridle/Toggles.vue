<script setup lang="ts">
import { Bug } from 'lucide-vue-next'

/**
 * The composer's two toggles, Debug and Markdown. One component because the
 * chat renders them in two places: under the composer in the card layout,
 * and inside the composer box in the frameless one (specs/017).
 *
 * On a phone they are compact, so the composer row keeps room for the
 * status at its other end (CLEAN-252): a bug for Debug, `.md` for Markdown.
 * The words stay in the markup for a screen reader and come back from `sm`.
 */
withDefaults(defineProps<{
  debugEnabled: boolean
  markdownEnabled: boolean
  togglingDebug: boolean
  // Debug is saved on the agent (PUT /agents/:id), so it is offered only to
  // a viewer who may manage the agent (CLEAN-232). Markdown is the viewer's
  // own display setting and stays.
  canDebug?: boolean
}>(), { canDebug: true })

defineEmits<{ toggleDebug: []; toggleMarkdown: [] }>()
</script>

<template>
  <button
    v-if="canDebug"
    type="button"
    data-debug-toggle
    :disabled="togglingDebug"
    :title="debugEnabled
      ? 'Prompt debug: ON — runtime is emitting debug snapshots. Click to disable.'
      : 'Prompt debug: OFF — click to enable. Pushed live to the agent without restart.'"
    :aria-pressed="debugEnabled"
    class="inline-flex cursor-pointer items-center rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted/70 disabled:cursor-wait disabled:opacity-50"
    :class="debugEnabled
      ? 'border border-foreground/30 text-foreground'
      : 'border border-transparent'"
    @click="$emit('toggleDebug')"
  >
    <Bug class="size-3.5 sm:hidden" aria-hidden="true" />
    <span class="max-sm:sr-only">Debug</span>
  </button>
  <button
    type="button"
    data-markdown-toggle
    :title="markdownEnabled ? 'Markdown: ON. Click to show messages as plain text.' : 'Markdown: OFF. Click to render messages as Markdown.'"
    :aria-pressed="markdownEnabled"
    class="inline-flex cursor-pointer items-center rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted/70"
    :class="markdownEnabled
      ? 'border border-foreground/30 text-foreground'
      : 'border border-transparent'"
    @click="$emit('toggleMarkdown')"
  >
    <span class="font-mono text-[11px] normal-case tracking-normal sm:hidden" aria-hidden="true">.md</span>
    <span class="max-sm:sr-only">Markdown</span>
  </button>
</template>
