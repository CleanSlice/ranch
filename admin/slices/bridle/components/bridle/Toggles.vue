<script setup lang="ts">
/**
 * The composer's two toggles, Debug and Markdown. One component because the
 * chat renders them in two places: under the composer in the card layout,
 * and inside the composer box in the frameless one (specs/017).
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
    class="cursor-pointer rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted/70 disabled:cursor-wait disabled:opacity-50"
    :class="debugEnabled
      ? 'border border-foreground/30 text-foreground'
      : 'border border-transparent'"
    @click="$emit('toggleDebug')"
  >
    Debug
  </button>
  <button
    type="button"
    class="cursor-pointer rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted/70"
    :class="markdownEnabled
      ? 'border border-foreground/30 text-foreground'
      : 'border border-transparent'"
    @click="$emit('toggleMarkdown')"
  >
    Markdown
  </button>
</template>
