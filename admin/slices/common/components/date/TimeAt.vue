<script setup lang="ts">
const props = defineProps<{
  date?: string | null;
}>();
</script>

<template>
  <div class="flex flex-col items-end text-xs">
    <TimeAgo v-if="date" :date="date" />
    <span v-else class="text-muted-foreground">—</span>
  </div>
</template>
