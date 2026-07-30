<script setup lang="ts">
import type { AgentLogLevel } from '#agent/utils/agentLogs';
import { IconLoader2, IconReload, IconX } from '@tabler/icons-vue';

const props = defineProps<{
  agentId: string;
  // Side-panel mode (chat tab): shows a close button and hides the label
  // on the refresh button to stay compact.
  closable?: boolean;
  // While the agent restarts, log fetches return transient K8s errors
  // (ContainerCreating 400s and the like). An overlay says what's actually
  // happening instead of surfacing that noise.
  restarting?: boolean;
  // First-ever start of this agent (server-derived launchContext='initial'):
  // the overlay reads "setting up" instead of "restarting", so a fresh deploy
  // doesn't look like an update of something that already existed.
  firstStart?: boolean;
}>();

const emit = defineEmits<{ close: [] }>();

const {
  logGroups,
  statusLabel,
  loading,
  error,
  autoRefresh,
  scrollRef,
  containerWaitingLabel,
  refresh,
} = useAgentLogs(props.agentId);

// Terminal-style level colors (light+dark), same palette approach as
// bridle's DebugPanel event-type map.
const LOG_LEVEL_CHIP: Record<AgentLogLevel, string> = {
  error: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30',
  warn: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
};
const LOG_LEVEL_TEXT: Record<AgentLogLevel, string> = {
  error: 'text-red-700 dark:text-red-300',
  warn: 'text-amber-700 dark:text-amber-300',
};
</script>

<template>
  <Card class="flex flex-col gap-0">
    <CardHeader class="flex flex-row items-center justify-between gap-2 space-y-0 border-b pb-3">
      <div class="flex items-center gap-2">
        <CardTitle class="text-sm font-semibold">Logs</CardTitle>
        <Label
          :for="`logs-auto-${agentId}`"
          class="flex items-center gap-1.5 text-xs font-normal text-muted-foreground"
        >
          <Checkbox :id="`logs-auto-${agentId}`" v-model="autoRefresh" />
          Auto 5s
        </Label>
      </div>
      <div class="flex items-center gap-1">
        <!-- IconReload + label, deliberately NOT IconRefresh — that icon means
             "restart the agent" everywhere else on this page. -->
        <Button
          size="sm"
          variant="ghost"
          class="h-7 px-2"
          title="Reload logs"
          :disabled="loading"
          @click="refresh"
        >
          <IconReload class="size-4" :class="{ 'animate-spin': loading }" />
          <span class="text-xs">Reload</span>
        </Button>
        <Button
          v-if="closable"
          size="sm"
          variant="ghost"
          class="h-7 px-2"
          title="Hide logs panel"
          @click="emit('close')"
        >
          <IconX class="size-4" />
        </Button>
      </div>
    </CardHeader>
    <CardContent class="relative flex-1 overflow-hidden p-0">
      <Transition
        enter-active-class="transition-opacity duration-200"
        leave-active-class="transition-opacity duration-200"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <div
          v-if="restarting"
          class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background/70 backdrop-blur-[2px]"
        >
          <IconLoader2 class="size-6 animate-spin text-primary" />
          <span class="text-sm font-medium">
            {{ firstStart ? 'Setting up agent…' : 'Agent is restarting…' }}
          </span>
          <span class="text-xs text-muted-foreground">
            {{
              firstStart
                ? 'First start — logs will appear once the agent’s pod is up.'
                : 'Logs will resume when the new pod is up.'
            }}
          </span>
        </div>
      </Transition>
      <div
        v-if="error && !restarting"
        class="m-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
      >
        {{ error }}
      </div>
      <div ref="scrollRef" class="h-full overflow-auto bg-muted/30 p-3">
        <div
          v-if="containerWaitingLabel"
          class="flex flex-col items-center gap-2 py-8 text-center text-xs text-muted-foreground"
        >
          <IconLoader2 class="size-5 animate-spin text-primary" />
          <span>{{ containerWaitingLabel }}…</span>
          <span class="text-[10px]">Logs will appear when the container starts.</span>
        </div>
        <div
          v-else-if="statusLabel"
          class="py-8 text-center text-xs italic text-muted-foreground"
        >
          {{ statusLabel }}
        </div>
        <div v-else-if="logGroups.length" class="font-mono text-xs leading-relaxed">
          <template v-for="group in logGroups" :key="group.key">
            <div v-if="group.day" class="my-2 flex items-center gap-2 first:mt-0">
              <div class="h-px flex-1 bg-border" />
              <span class="shrink-0 text-[10px] font-medium tracking-wide text-muted-foreground">
                {{ group.day }}
              </span>
              <div class="h-px flex-1 bg-border" />
            </div>
            <div
              v-for="(line, i) in group.lines"
              :key="`${group.key}-${i}`"
              class="flex items-start gap-2"
            >
              <span
                v-if="line.time"
                class="shrink-0 select-none tabular-nums text-muted-foreground/70"
              >{{ line.time }}</span>
              <span
                v-if="line.level"
                class="mt-px shrink-0 select-none rounded border px-1 text-[10px] font-semibold uppercase leading-4"
                :class="LOG_LEVEL_CHIP[line.level]"
              >{{ line.level }}</span>
              <span
                class="min-w-0 flex-1 whitespace-pre-wrap wrap-break-word"
                :class="line.level ? LOG_LEVEL_TEXT[line.level] : ''"
              >{{ line.text }}</span>
            </div>
          </template>
        </div>
        <div
          v-else-if="loading"
          class="py-8 text-center text-xs text-muted-foreground"
        >
          Loading…
        </div>
        <div v-else class="py-8 text-center text-xs text-muted-foreground">
          No logs yet.
        </div>
      </div>
    </CardContent>
  </Card>
</template>
