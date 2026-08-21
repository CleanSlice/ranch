<script setup lang="ts">
import type { IAgentData } from '#agent/domain';
import type { ChatOverlay } from '#agent/composables/useAgentLifecycle';
import type { AgentTab } from './sections';

const props = defineProps<{
  agent: IAgentData;
  apiUrl: string;
  tab: AgentTab;
  overlay: ChatOverlay;
  restarting: boolean;
  toggling: boolean;
}>();

const emit = defineEmits<{
  restart: [];
  toggleRunning: [];
  'agent-updated': [IAgentData];
}>();

const chatActive = computed(() => props.tab === 'chat');

// One "restart is underway" signal for the full-width logs view, matching what
// the chat tab derives for its own side panel.
const restartUnderway = computed(
  () => props.restarting || props.overlay?.kind === 'starting',
);
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- Chat. `v-show`, NEVER `v-if`: unmounting drops the websocket, the
         transcript, the scroll position and the restart overlay state, so
         coming back from another tab would cost a reconnect and a refetch.
         Hidden, the conversation keeps living behind whatever is open.

         `:active` lets the chat skip mounting its own side logs while it is
         hidden — otherwise the Logs tab would have two log panels polling at
         once, one of them invisible. -->
    <div v-show="chatActive" class="min-h-0 flex-1">
      <AgentChatTab
        :agent="agent"
        :api-url="apiUrl"
        :overlay="overlay"
        :restarting="restarting"
        :toggling="toggling"
        :active="chatActive"
        @restart="emit('restart')"
        @toggle-running="emit('toggleRunning')"
      />
    </div>

    <!-- Everything else mounts fresh and unmounts when left — the
         remount-on-activate refetch behaviour these components had as
         `TabsContent`, preserved. -->
    <div v-if="!chatActive" class="min-h-0 flex-1 overflow-y-auto">
      <AgentOverviewTab
        v-if="tab === 'overview'"
        :agent="agent"
        :api-url="apiUrl"
        @agent-updated="(updated: IAgentData) => emit('agent-updated', updated)"
      />

      <AgentKnowledgeTab v-else-if="tab === 'knowledge'" :agent="agent" />

      <Card v-else-if="tab === 'files'">
        <CardHeader>
          <CardTitle>Files</CardTitle>
          <CardDescription>
            Agent data stored in S3 (<code>agents/{{ agent.id }}/</code>).
            <code>.md</code> and <code>.json</code> files can be edited;
            changes apply on next agent restart.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AgentFileProvider :id="agent.id" />
        </CardContent>
      </Card>

      <AgentChannelProvider
        v-else-if="tab === 'channels'"
        :agent-id="agent.id"
      />

      <AgentLogsPanel
        v-else-if="tab === 'logs'"
        :agent-id="agent.id"
        :restarting="restartUnderway"
        :first-start="agent.launchContext === 'initial'"
        class="h-full"
      />

      <Card v-else-if="tab === 'secrets'">
        <CardHeader>
          <CardTitle>Secrets</CardTitle>
          <CardDescription>
            User-scoped secrets stored by the agent runtime. Source depends on
            <code>SECRET_PROVIDER</code>:
            <code>aws</code> reads from AWS Secrets Manager
            (<code>aws_secret_prefix/&lt;agentId&gt;</code>);
            <code>file</code> lists S3 under
            <code>agents/{{ agent.id }}/data/secrets/</code>. Values are
            masked — click the eye icon to reveal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AgentSecretProvider :id="agent.id" />
        </CardContent>
      </Card>

      <AgentEnvTab v-else-if="tab === 'env'" :agent-id="agent.id" />

      <ChatListProvider v-else-if="tab === 'chats'" :agent-id="agent.id" />

      <AgentPaddockTab v-else-if="tab === 'paddock'" :agent-id="agent.id" />
    </div>
  </div>
</template>
