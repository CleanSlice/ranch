<script setup lang="ts">
/**
 * The bubble a chat message sits in (CLEAN-137): the fill, the corners, the
 * padding, and `chat-md` on an agent's bubble so its rendered markdown picks
 * up `assets/chat-md.css`. Shared by the live chat and the chat history;
 * what goes inside is the caller's.
 */
defineProps<{
  user?: boolean;
  /** On its way and not confirmed yet: drawn fainter. */
  dimmed?: boolean;
}>();
</script>

<template>
  <div
    class="max-w-full wrap-break-word px-4 py-2.5 text-sm leading-relaxed shadow-sm transition-opacity"
    :class="[
      user
        ? 'whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary text-primary-foreground'
        : 'chat-md rounded-2xl rounded-tl-md bg-muted text-foreground',
      dimmed && 'opacity-70',
    ]"
  >
    <slot />
  </div>
</template>
