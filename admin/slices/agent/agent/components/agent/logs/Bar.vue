<script setup lang="ts">
/**
 * Pod logs as a bar under the composer (specs/017, R5).
 *
 * Collapsed, it is one row: the newest line and how many entries sit behind
 * it (`AgentLogsBarSummary`, which owns its own `useAgentLogs`). Expanded, it
 * is the existing logs panel in a region below the composer. The two are
 * `v-if` branches so exactly one `useAgentLogs` instance — one 5 s poller —
 * exists at any moment; the host mounts this only while the chat is the
 * active tab, so nothing polls behind Settings either (SC-005).
 */
defineProps<{
  agentId: string;
  restarting: boolean;
  firstStart: boolean;
}>();

const expanded = ref(false);
</script>

<template>
  <div class="flex min-h-0 flex-col" :class="expanded && 'basis-2/5'">
    <AgentLogsBarSummary
      v-if="!expanded"
      :agent-id="agentId"
      :restarting="restarting"
      :first-start="firstStart"
      @expand="expanded = true"
    />
    <div v-else class="min-h-56 flex-1 overflow-hidden">
      <AgentLogsPanel
        :agent-id="agentId"
        closable
        :restarting="restarting"
        :first-start="firstStart"
        class="h-full min-w-0"
        @close="expanded = false"
      />
    </div>
  </div>
</template>
