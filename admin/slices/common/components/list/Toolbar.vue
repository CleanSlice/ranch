<script setup lang="ts">
/**
 * The row above a list (CLEAN-132): search and filters on the left, sort and
 * view on the right, wrapping on a narrow screen. Pages put `ListSearch`,
 * `ListSegments` in the default slot and `ListSort`, `ListViewToggle` in
 * `end`, so every list header lines up the same way.
 */
</script>

<template>
  <div class="flex flex-wrap items-center gap-2.5">
    <slot />
    <div v-if="$slots.end" class="ml-auto flex items-center gap-2.5">
      <slot name="end" />
    </div>
  </div>
</template>
