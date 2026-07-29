<script setup lang="ts">
import type { IAgentData } from '#agent/domain';

const props = defineProps<{
  agent: IAgentData;
  apiUrl: string;
}>();

const emit = defineEmits<{ agentUpdated: [agent: IAgentData] }>();

const agentRef = computed(() => props.agent);
const { template, effective, resolved, pending } = useAgentKnowledges(
  props.agent.id,
  agentRef,
);
</script>

<template>
  <div class="flex flex-col gap-6">
    <AgentOverviewUsageCard :agent-id="agent.id" />
    <AgentOverviewLlmCard :agent-id="agent.id" :llm-credential-id="agent.llmCredentialId" />
    <AgentOverviewKnowledgeCard
      :source="effective.source"
      :knowledges="resolved"
      :pending="pending"
    />
    <AgentOverviewMetricsCard :agent-id="agent.id" />
    <AgentOverviewRuntimeCard :agent="agent" :template-name="template?.name ?? null" />
    <AgentVisibilityProvider
      :agent-id="agent.id"
      :api-url="apiUrl"
      :is-public="agent.isPublic"
      :allowed-origins="agent.allowedOrigins"
      @saved="(updated) => emit('agentUpdated', updated)"
    />
  </div>
</template>
