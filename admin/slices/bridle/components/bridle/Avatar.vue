<script setup lang="ts">
import { Bot, User } from 'lucide-vue-next'
import { cn } from '#theme/utils/cn'

/**
 * Who said it: the round chip beside a chat bubble (CLEAN-137). One
 * component for the live chat and the chat history, so the two cannot draw
 * the same speaker differently again.
 */
defineProps<{ user?: boolean }>()
</script>

<template>
  <div
    :class="cn(
      'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs',
      user ? 'bg-primary text-primary-foreground' : 'bg-muted',
    )"
  >
    <User v-if="user" class="h-4 w-4" />
    <Bot v-else class="h-4 w-4" />
  </div>
</template>
