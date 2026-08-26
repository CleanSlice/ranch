<script setup lang="ts">
import type { IChatSession } from '#chat/stores/chat';

defineProps<{ session: IChatSession }>();
const showTools = defineModel<boolean>('showTools', { required: true });
</script>

<template>
  <div class="flex flex-col gap-2.5 rounded-xl border border-border/70 bg-card px-4 py-3.5">
    <div class="flex items-center justify-between gap-3 text-[12.5px]">
      <span class="text-muted-foreground/70">Messages</span>
      <span class="font-medium">
        {{ session.messageCount }} · {{ session.userMessageCount }} from user
      </span>
    </div>
    <div class="flex items-center justify-between gap-3 text-[12.5px]">
      <span class="text-muted-foreground/70">Last activity</span>
      <span class="font-medium">
        {{ session.lastMessageAt ? formatDateTime(session.lastMessageAt) : '—' }}
      </span>
    </div>
    <div class="flex items-center justify-between gap-3 text-[12.5px]">
      <span class="text-muted-foreground/70">Session</span>
      <span class="truncate font-mono text-[11.5px] text-foreground/80">
        {{ session.sessionKey }}
      </span>
    </div>

    <div class="h-px bg-border/50" />

    <label class="flex cursor-pointer items-center gap-2 text-[12.5px] text-foreground/80">
      <button
        type="button"
        role="switch"
        :aria-checked="showTools"
        class="relative h-[18px] w-8 shrink-0 rounded-full transition-colors"
        :class="showTools ? 'bg-primary' : 'bg-muted-foreground/25'"
        @click="showTools = !showTools"
      >
        <span
          class="absolute top-0.5 size-3.5 rounded-full bg-white shadow-sm transition-[left]"
          :class="showTools ? 'left-[15px]' : 'left-0.5'"
        />
      </button>
      Tool events
    </label>
  </div>
</template>
