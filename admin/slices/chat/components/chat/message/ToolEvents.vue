<script setup lang="ts">
import { ChevronRight } from 'lucide-vue-next';
import { formatDuration, type IToolEvent } from '#chat/utils/transcript';

defineProps<{ tools: IToolEvent[] }>();

const open = ref<Record<string, boolean>>({});
</script>

<template>
  <div class="flex flex-col gap-1">
    <div
      v-for="t in tools"
      :key="t.id"
      class="overflow-hidden rounded-[10px] border border-border/70 bg-muted/20"
    >
      <button
        type="button"
        class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/40"
        @click="open[t.id] = !open[t.id]"
      >
        <ChevronRight
          class="size-3 shrink-0 text-muted-foreground/60 transition-transform"
          :class="open[t.id] && 'rotate-90'"
        />
        <span
          class="rounded-[5px] bg-muted px-1.5 py-px text-[11px] font-medium text-muted-foreground"
        >
          tool
        </span>
        <span class="font-mono text-xs text-foreground/80">{{ t.name }}</span>
        <span class="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground/70">
          {{ t.args }}
        </span>
        <span
          v-if="t.durationMs !== null"
          class="shrink-0 text-[11px] text-muted-foreground/60"
        >
          {{ formatDuration(t.durationMs) }}
        </span>
      </button>
      <div
        v-if="open[t.id]"
        class="flex flex-col gap-1.5 border-t border-border/50 px-3 py-2"
      >
        <template v-if="t.args">
          <div class="text-[10.5px] uppercase tracking-wider text-muted-foreground/60">
            Request
          </div>
          <pre
            class="max-h-64 overflow-y-auto whitespace-pre-wrap wrap-break-word font-mono text-xs text-foreground/80"
            >{{ t.args }}</pre
          >
        </template>
        <template v-if="t.result !== null">
          <div class="text-[10.5px] uppercase tracking-wider text-muted-foreground/60">
            Result
          </div>
          <pre
            class="max-h-64 overflow-y-auto whitespace-pre-wrap wrap-break-word font-mono text-xs text-foreground/80"
            >{{ t.result }}</pre
          >
        </template>
      </div>
    </div>
  </div>
</template>
