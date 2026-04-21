<template>
  <div
    class="relative rounded-2xl border bg-card shadow-xl p-5 overflow-hidden"
  >
    <div
      class="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-primary/10 blur-3xl pointer-events-none"
    />
    <div class="flex items-center gap-3 mb-4">
      <div
        class="w-10 h-10 rounded-full bg-primary/15 text-primary flex items-center justify-center font-semibold"
      >
        {{ initials }}
      </div>
      <div class="min-w-0">
        <div class="font-semibold truncate">{{ agent.name }}</div>
        <div class="text-xs text-muted-foreground truncate">
          {{ agent.templateId }}
        </div>
      </div>
      <span
        class="ml-auto px-2 py-0.5 rounded-full text-[10px] uppercase"
        :class="statusClass"
      >
        {{ agent.status }}
      </span>
    </div>

    <div class="space-y-2.5 mb-4">
      <div class="flex items-start gap-2">
        <div
          class="shrink-0 w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs"
        >
          👋
        </div>
        <div
          class="rounded-lg rounded-tl-none bg-muted px-3 py-2 text-sm max-w-[85%]"
        >
          Hi! I'm ready to help you ship.
        </div>
      </div>
      <div class="flex items-start gap-2 justify-end">
        <div
          class="rounded-lg rounded-tr-none bg-primary text-primary-foreground px-3 py-2 text-sm max-w-[85%]"
        >
          Deploy a new worker to staging.
        </div>
        <div
          class="shrink-0 w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs"
        >
          🧑
        </div>
      </div>
      <div class="flex items-start gap-2">
        <div
          class="shrink-0 w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs"
        >
          ⚙️
        </div>
        <div
          class="rounded-lg rounded-tl-none bg-muted px-3 py-2 text-sm max-w-[85%] animate-pulse"
        >
          Submitting workflow…
        </div>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-2 text-xs">
      <div class="rounded-md border px-3 py-2">
        <div class="text-muted-foreground">CPU</div>
        <div class="font-medium">{{ agent.resources?.cpu ?? '—' }}</div>
      </div>
      <div class="rounded-md border px-3 py-2">
        <div class="text-muted-foreground">Memory</div>
        <div class="font-medium">{{ agent.resources?.memory ?? '—' }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { IAgentData } from '#agent/stores/agent';

const props = defineProps<{ agent: IAgentData }>();

const initials = computed(() =>
  props.agent.name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('') || '🤖',
);

const statusClass = computed(() => {
  const map: Record<string, string> = {
    running: 'bg-green-100 text-green-800',
    pending: 'bg-yellow-100 text-yellow-800',
    deploying: 'bg-blue-100 text-blue-800',
    failed: 'bg-red-100 text-red-800',
    stopped: 'bg-gray-100 text-gray-800',
  };
  return map[props.agent.status] || 'bg-gray-100 text-gray-800';
});
</script>
