<script setup lang="ts">
/**
 * Chart or table (CLEAN-258): the switch in a card's header that shows the
 * same numbers as rows. It is how a chart is read without seeing it, so it
 * is a real button with a pressed state, not a link.
 */
const pressed = defineModel<boolean>({ required: true });
</script>

<template>
  <button
    type="button"
    class="stats-tblbtn"
    :aria-pressed="pressed"
    data-stats-table-toggle
    @click="pressed = !pressed"
  >
    {{ $t('stats.state.table') }}
  </button>
</template>
