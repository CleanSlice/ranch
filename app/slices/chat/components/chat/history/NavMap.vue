<script setup lang="ts">
import type { INavMapItem } from '#chat/utils/transcript';

defineProps<{ items: INavMapItem[] }>();
defineEmits<{ jump: [id: string] }>();
</script>

<template>
  <div
    v-if="items.length"
    class="flex flex-col gap-2 rounded-xl border border-border/70 bg-card px-4 pb-2 pt-3.5"
  >
    <span
      class="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70"
    >
      {{ $t('session.navigation') }}
    </span>
    <div class="-mx-2 flex max-h-64 flex-col overflow-y-auto">
      <button
        v-for="mi in items"
        :key="mi.id"
        type="button"
        class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/50"
        @click="$emit('jump', mi.id)"
      >
        <span
          class="size-[7px] shrink-0 rounded-full"
          :class="mi.isUser ? 'bg-primary' : 'bg-muted-foreground/30'"
        />
        <span class="truncate text-xs text-foreground/80">{{ mi.snippet }}</span>
      </button>
    </div>
  </div>
</template>
