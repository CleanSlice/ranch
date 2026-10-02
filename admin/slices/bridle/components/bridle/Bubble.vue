<script setup lang="ts">
import { cn } from '#theme/utils/cn'

/**
 * The bubble a chat message sits in (CLEAN-137): the fill, the corners, the
 * padding, and `chat-md` when its content is rendered markdown. Shared by
 * the live chat and the chat history; what goes inside is the caller's.
 */
defineProps<{
  user?: boolean
  /** The content is markdown HTML: turn on the chat markdown stylesheet. */
  markdown?: boolean
  /** Still being written by the agent. */
  streaming?: boolean
}>()
</script>

<template>
  <div
    :class="cn(
      'min-w-0 rounded-lg px-3 py-2 text-sm space-y-2',
      user ? 'bg-primary text-primary-foreground' : 'bg-muted',
      !user && markdown && 'chat-md',
      streaming && 'border-l-2 border-primary',
    )"
  >
    <slot />
  </div>
</template>
