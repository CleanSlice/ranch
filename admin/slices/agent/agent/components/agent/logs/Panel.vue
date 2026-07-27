<script setup lang="ts">
import { IconLoader2, IconReload, IconX } from '@tabler/icons-vue';

const props = defineProps<{
  agentId: string;
  // Side-panel mode (chat tab): shows a close button and hides the label
  // on the refresh button to stay compact.
  closable?: boolean;
}>();

const emit = defineEmits<{ close: [] }>();

const {
  logs,
  loading,
  error,
  autoRefresh,
  scrollRef,
  containerWaitingLabel,
  refresh,
} = useAgentLogs(props.agentId);
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
    <CardContent class="flex-1 overflow-hidden p-0">
      <div
        v-if="error"
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
        <pre
          v-else-if="logs"
          class="whitespace-pre-wrap wrap-break-word font-mono text-xs leading-relaxed"
        >{{ logs }}</pre>
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
