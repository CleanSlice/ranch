<script setup lang="ts">
// A conversation that is on its way: bubbles of no one's words, alternating
// sides like the real thing. The console's one way of saying "the messages
// are being loaded": the live chat while it opens (CLEAN-260) and a closed
// conversation's first page (CLEAN-253) both draw this.

// Widths of the placeholder bubbles; even ones are the person's, on the right.
const BUBBLES = ['w-2/5', 'w-3/5', 'w-1/3', 'w-1/2', 'w-2/5'];
</script>

<template>
  <div class="flex flex-col gap-4" role="status" aria-busy="true">
    <span class="sr-only">{{ $t('chat.loading') }}</span>
    <div
      v-for="(width, i) in BUBBLES"
      :key="i"
      class="flex items-start gap-2.5"
      :class="i % 2 === 0 ? 'justify-end' : undefined"
      aria-hidden="true"
    >
      <div
        v-if="i % 2 === 1"
        class="h-7 w-7 shrink-0 animate-pulse rounded-full bg-muted"
      />
      <div
        class="h-11 animate-pulse rounded-2xl"
        :class="[width, i % 2 === 0 ? 'bg-primary/20' : 'bg-muted']"
      />
    </div>
  </div>
</template>
