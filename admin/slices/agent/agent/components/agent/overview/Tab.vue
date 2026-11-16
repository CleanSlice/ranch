<script setup lang="ts">
import type { IAgentData } from '#agent/domain';
import { provideAgentDraft } from '#agent/composables/useAgentDraft';
import { provideAgentMetrics } from '#agent/composables/useAgentMetrics';
import { useUnsavedGuard } from '#agent/composables/useUnsavedGuard';

/**
 * Overview (CLEAN-228, FR-008): a summary strip and six blocks, in this
 * order, then the one save bar. Each block reads the stores by agent id and
 * the page's draft by injection (docs/state.md) — this component hands them
 * the id and nothing else of the agent.
 */
const props = defineProps<{
  agent: IAgentData;
  apiUrl: string;
}>();

// Kept for the parent's listener. Nothing is emitted any more: a save writes
// the agent store's record itself (`agentStore.update` upserts), which is what
// the parent rendered from all along.
defineEmits<{ agentUpdated: [agent: IAgentData] }>();

// One draft for the whole page: every block below edits it, the bar at the
// bottom saves or discards it, and nothing leaves the page with edits in it
// unasked.
const draft = provideAgentDraft(() => props.agent.id);
useUnsavedGuard(draft.isDirty, {
  count: draft.count,
  onDiscard: draft.discard,
});

// One poll of the pod's live figures for the strip, Configuration ("in use
// now") and Advanced (node disk). It stops while the tab is hidden.
provideAgentMetrics(() => props.agent.id);
</script>

<template>
  <div class="flex flex-col gap-4 pb-3" data-overview>
    <AgentOverviewSummary :agent-id="agent.id" />
    <AgentOverviewConfigCard :agent-id="agent.id" />
    <AgentOverviewLimitCard :agent-id="agent.id" />
    <AgentOverviewAccessCard :agent-id="agent.id" :api-url="apiUrl" />
    <AgentOverviewUsageCard :agent-id="agent.id" />
    <AgentOverviewAdvancedCard :agent-id="agent.id" />
    <AgentOverviewDangerCard :agent-id="agent.id" />
    <AgentOverviewSaveBar />
  </div>
</template>
