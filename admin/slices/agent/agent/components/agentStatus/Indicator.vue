<script setup lang="ts">
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '#theme/components/ui/tooltip';

const store = useAgentStatusStore();

onMounted(() => store.connect());
onBeforeUnmount(() => store.disconnect());

const dotClass = computed(() => {
  if (store.connectionState === 'connected') {
    return store.failingCount > 0 ? 'bg-red-500' : 'bg-emerald-500';
  }
  if (store.connectionState === 'connecting') return 'bg-amber-400';
  return 'bg-muted-foreground/50';
});

const pulseClass = computed(() =>
  store.connectionState === 'connected' && store.failingCount === 0
    ? 'animate-ping bg-emerald-500/60'
    : '',
);

const totalAgents = computed(() => Object.keys(store.agents).length);
const runningCount = computed(
  () =>
    Object.values(store.statuses).filter(
      (s) => s.phase === 'Running' && s.ready,
    ).length,
);

const label = computed(() => {
  switch (store.connectionState) {
    case 'connected':
      return 'Live';
    case 'connecting':
      return 'Connecting…';
    case 'disconnected':
      return 'Reconnecting…';
    default:
      return 'Idle';
  }
});
</script>

<template>
  <TooltipProvider :delay-duration="200">
    <Tooltip>
      <TooltipTrigger as-child>
        <div
          class="flex items-center gap-2 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground transition-colors cursor-default select-none"
        >
          <span class="relative flex h-2.5 w-2.5">
            <span
              v-if="pulseClass"
              :class="pulseClass"
              class="absolute inline-flex h-full w-full rounded-full opacity-75"
            />
            <span
              :class="dotClass"
              class="relative inline-flex rounded-full h-2.5 w-2.5"
            />
          </span>
          <span class="font-medium">{{ label }}</span>
          <span
            v-if="store.failingCount > 0"
            class="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-semibold"
          >
            {{ store.failingCount }}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end">
        <div class="text-xs space-y-0.5">
          <div class="font-medium">Agent status stream</div>
          <div>State: {{ store.connectionState }}</div>
          <div>Agents: {{ totalAgents }}</div>
          <div>Running &amp; ready: {{ runningCount }}</div>
          <div v-if="store.failingCount > 0" class="text-red-400">
            Failing: {{ store.failingCount }}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>
