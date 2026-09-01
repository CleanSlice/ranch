<script setup lang="ts">
import type { IAgentData } from '#agent/domain';

const props = defineProps<{
  agent: IAgentData;
  templateName: string | null;
}>();

const agentStatusStore = useAgentStatusStore();
const podStatus = computed(() => agentStatusStore.statuses[props.agent.id] ?? null);
const podLabel = computed(() => podPhaseLabel(podStatus.value));

// The SSE record is fresher than the fetched row (the drift sweep writes
// 'unreachable' between refetches) — prefer it when present.
const liveAgent = computed(() => agentStatusStore.agents[props.agent.id]);
const displayStatus = computed(
  () => (liveAgent.value?.status as IAgentData['status']) || props.agent.status,
);
const statusReason = computed(
  () => liveAgent.value?.statusReason ?? props.agent.statusReason,
);
// Explicit `=== false`: undefined just means the stream hasn't reported yet.
const runtimeOffline = computed(
  () =>
    displayStatus.value === 'running' &&
    agentStatusStore.bridleConnected[props.agent.id] === false,
);
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Runtime</CardTitle>
      <CardDescription>Current state of this agent.</CardDescription>
    </CardHeader>
    <CardContent>
      <dl class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <dt class="text-xs text-muted-foreground">Status</dt>
          <dd class="mt-1 flex items-center gap-2">
            <Badge :variant="AGENT_STATUS_VARIANT[displayStatus]" class="capitalize">
              {{ displayStatus }}
            </Badge>
            <span
              v-if="podLabel"
              class="text-xs text-muted-foreground"
              :title="podStatus?.message ?? ''"
            >
              pod: {{ podLabel }}<span v-if="podStatus && podStatus.restartCount > 0">
                · restarts {{ podStatus.restartCount }}</span>
            </span>
          </dd>
          <p
            v-if="
              (displayStatus === 'failed' || displayStatus === 'unreachable') &&
              statusReason
            "
            class="mt-1 text-xs text-destructive"
          >
            {{ statusReason }}
          </p>
          <p
            v-else-if="runtimeOffline"
            class="mt-1 text-xs text-orange-600 dark:text-orange-400"
          >
            Pod is up but the runtime hasn't connected to the bridle hub yet.
          </p>
        </div>
        <div>
          <dt class="text-xs text-muted-foreground">Visibility</dt>
          <dd class="mt-1">
            <Badge :variant="agent.isPublic ? 'default' : 'outline'">
              {{ agent.isPublic ? 'Public' : 'Private' }}
            </Badge>
          </dd>
        </div>
        <div>
          <dt class="text-xs text-muted-foreground">Template</dt>
          <dd class="mt-1 text-sm">
            <NuxtLink
              :to="`/templates/${agent.templateId}`"
              class="text-primary hover:underline"
            >
              {{ templateName || agent.templateId }}
            </NuxtLink>
          </dd>
        </div>
        <div>
          <dt class="text-xs text-muted-foreground">Resources</dt>
          <dd class="mt-1 text-sm">{{ agent.resources.cpu }} / {{ agent.resources.memory }}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted-foreground">Workflow</dt>
          <dd class="mt-1 text-sm text-muted-foreground">{{ agent.workflowId ?? '—' }}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted-foreground">Created</dt>
          <dd class="mt-1 text-sm">{{ formatDateTime(agent.createdAt) }}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted-foreground">Updated</dt>
          <dd class="mt-1 text-sm">{{ formatDateTime(agent.updatedAt) }}</dd>
        </div>
      </dl>
    </CardContent>
  </Card>
</template>
