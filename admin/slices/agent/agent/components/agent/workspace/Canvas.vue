<script setup lang="ts">
import type { IAgentData } from '#agent/domain';
import type { ChatOverlay } from '#agent/composables/useAgentLifecycle';
import {
  SECTIONS,
  settingsSectionOf,
  type AgentTab,
  type SectionCounts,
  type SectionValue,
} from './sections';

const props = defineProps<{
  agent: IAgentData;
  apiUrl: string;
  tab: AgentTab;
  counts: SectionCounts;
  overlay: ChatOverlay;
  restarting: boolean;
  toggling: boolean;
}>();

const emit = defineEmits<{
  restart: [];
  toggleRunning: [];
  setTab: [tab: AgentTab];
  'agent-updated': [IAgentData];
}>();

const chatActive = computed(() => props.tab === 'chat');

// Settings always has one section open beside its list (specs/017, R2): the
// one `?tab=` names, or the default for a bare `settings`. Null for the chat.
const section = computed(() => settingsSectionOf(props.tab));
const open = computed(() => (section.value?.value ?? null) as SectionValue | null);

// One "restart is underway" signal for the full-width logs view, matching what
// the chat tab derives for its own logs bar.
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

         `:active` lets the chat skip mounting its logs bar while it is
         hidden — otherwise the Logs section would have two log pollers at
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

    <!-- Settings: the list of sections on the left, the open one on the
         right. The list stays put while the content swaps, so every section
         is one click from every other. -->
    <div
      v-if="open"
      class="flex min-h-0 flex-1 flex-col gap-2.5 lg:flex-row lg:gap-3"
    >
      <AgentWorkspaceSettingsNav
        :sections="SECTIONS"
        :counts="counts"
        :active="open"
        @select="(v) => emit('setTab', v)"
      />

      <!-- Keyed by section: each one mounts fresh and unmounts when left —
           the remount-on-activate refetch behaviour these components had as
           `TabsContent`, preserved — and the scroll position resets with it. -->
      <div
        :key="open"
        role="tabpanel"
        :aria-label="section?.title"
        class="min-h-0 min-w-0 flex-1 overflow-y-auto"
      >
        <AgentOverviewTab
          v-if="open === 'overview'"
          :agent="agent"
          :api-url="apiUrl"
          @agent-updated="(updated: IAgentData) => emit('agent-updated', updated)"
        />

        <AgentKnowledgeTab v-else-if="open === 'knowledge'" :agent="agent" />

        <PeerTab v-else-if="open === 'a2a'" :agent="agent" />

        <Card v-else-if="open === 'files'">
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
          v-else-if="open === 'channels'"
          :agent-id="agent.id"
        />

        <AgentLogsPanel
          v-else-if="open === 'logs'"
          :agent-id="agent.id"
          :restarting="restartUnderway"
          :first-start="agent.launchContext === 'initial'"
          class="h-full"
        />

        <!-- Keyed by agent: the table loads and watches the agent it was
             mounted for, so another agent gets a fresh one. -->
        <AgentEventTable
          v-else-if="open === 'events'"
          :key="agent.id"
          :agent-id="agent.id"
        />

        <Card v-else-if="open === 'secrets'">
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

        <AgentEnvTab v-else-if="open === 'env'" :agent-id="agent.id" />

        <ChatListProvider v-else-if="open === 'chats'" :agent-id="agent.id" />

        <AgentPaddockTab v-else-if="open === 'paddock'" :agent-id="agent.id" />
      </div>
    </div>
  </div>
</template>
