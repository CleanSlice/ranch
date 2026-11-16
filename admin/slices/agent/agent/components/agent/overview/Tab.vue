<script setup lang="ts">
import type { IAgentData } from '#agent/domain';
import { provideAgentDraft } from '#agent/composables/useAgentDraft';
import { useUnsavedGuard } from '#agent/composables/useUnsavedGuard';

const props = defineProps<{
  agent: IAgentData;
  apiUrl: string;
}>();

// Kept for the parent's listener. Nothing is emitted any more: a save writes
// the agent store's record itself (`agentStore.update` upserts), which is what
// the parent rendered from all along.
defineEmits<{ agentUpdated: [agent: IAgentData] }>();

const agentRef = computed(() => props.agent);
const { template, effective, resolved, pending } = useAgentKnowledges(
  props.agent.id,
  agentRef,
);

// One draft for the whole page (CLEAN-228): every block below edits it, the
// bar at the bottom saves or discards it, and nothing leaves the page with
// edits in it unasked.
const draft = provideAgentDraft(() => props.agent.id);
useUnsavedGuard(draft.isDirty, {
  count: draft.count,
  onDiscard: draft.discard,
});
</script>

<template>
  <div class="flex flex-col gap-6" data-overview>
    <AgentOverviewUsageCard :agent-id="agent.id" />
    <AgentLoadProvider :agent-id="agent.id" />
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
    />
    <AgentOverviewSaveBar />
  </div>
</template>
