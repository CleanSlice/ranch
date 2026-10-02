<script setup lang="ts">
/**
 * The agent's chip beside a chat bubble (CLEAN-137): its initial when the
 * name is known, a bot glyph when it is not. One component for the live
 * chat and the chat history, so the two cannot draw the agent differently.
 */
const props = defineProps<{ name?: string }>();

const initial = computed(() => {
  const first = props.name?.trim().split(/\s+/).filter(Boolean)[0]?.[0];
  return first ? first.toUpperCase() : null;
});
</script>

<template>
  <div
    class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-primary/25 to-primary/5 text-[11px] font-semibold text-primary"
    :title="name"
  >
    <template v-if="initial">{{ initial }}</template>
    <Icon v-else name="bot" :size="14" />
  </div>
</template>
