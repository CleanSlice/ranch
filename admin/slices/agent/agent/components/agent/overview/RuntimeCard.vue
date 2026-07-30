<script setup lang="ts">
import type { IAgentData } from '#agent/domain';

const props = defineProps<{
  agent: IAgentData;
  templateName: string | null;
}>();

const agentStatusStore = useAgentStatusStore();
const podStatus = computed(() => agentStatusStore.statuses[props.agent.id] ?? null);
const podLabel = computed(() => podPhaseLabel(podStatus.value));
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
            <Badge :variant="AGENT_STATUS_VARIANT[agent.status]" class="capitalize">
              {{ agent.status }}
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
            v-if="agent.status === 'failed' && agent.statusReason"
            class="mt-1 text-xs text-destructive"
          >
            {{ agent.statusReason }}
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
