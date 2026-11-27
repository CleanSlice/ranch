<script setup lang="ts">
import { IconLock } from '@tabler/icons-vue';

/**
 * One quiet line saying that something is left out of what is on screen
 * because of who is looking, not because it is missing or failed
 * (CLEAN-269). The text is the caller's: this is only how such a line looks,
 * so that it reads the same on every page that has one.
 */
</script>

<template>
  <p
    class="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground"
    data-access-note
  >
    <IconLock class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
    <span class="min-w-0"><slot /></span>
  </p>
</template>
