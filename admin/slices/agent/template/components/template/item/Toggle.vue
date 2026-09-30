<script setup lang="ts">
/**
 * The on/off switch drawn on skill cards and MCP rows (CLEAN-130). Purely
 * visual: the card around it is the control, so this carries no click of
 * its own and only tells the eye which way the row is set.
 */
defineProps<{ on: boolean; locked?: boolean }>();
</script>

<template>
  <span
    class="relative block h-5 w-[34px] shrink-0 rounded-full transition-colors duration-150"
    :class="[on ? 'bg-primary' : 'bg-muted-foreground/25', locked && 'opacity-50']"
    aria-hidden="true"
  >
    <span
      class="absolute top-0.5 size-4 rounded-full bg-background shadow-[0_1px_2px_rgba(0,0,0,.25)] transition-[left] duration-150"
      :class="on ? 'left-4' : 'left-0.5'"
    />
  </span>
</template>
