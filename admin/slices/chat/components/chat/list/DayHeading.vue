<script setup lang="ts">
import { useRelativeTime } from '#common/composables/useRelativeTime';
import { formatDay } from '#common/utils/format';
import { chatCountLabel } from '#chat/utils/chatList';

// The strip over one day's rows: the day, how far back it is (live, so a
// page left open stays honest), and how many chats sit under it.
const props = defineProps<{ at: string; count: number }>();

const distance = useRelativeTime(() => props.at);
</script>

<template>
  <div
    class="flex items-center justify-between gap-3 border-b bg-muted/40 px-5 py-1.5 text-xs"
  >
    <div class="flex items-baseline gap-2">
      <span class="font-semibold text-foreground">{{ formatDay(at) }}</span>
      <span class="text-muted-foreground">{{ distance }}</span>
    </div>
    <span class="text-muted-foreground">{{ chatCountLabel(count) }}</span>
  </div>
</template>
