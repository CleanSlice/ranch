<script setup lang="ts">
import { IconChevronLeft } from '@tabler/icons-vue';
import type { IAgentData } from '#agent/domain';
import type { ChatOverlay } from '#agent/composables/useAgentLifecycle';
import {
  AGENT_SETTINGS_SECTIONS,
  type AgentSettingsSection,
} from '#agent/components/agent/settings/sections';

const props = defineProps<{
  agent: IAgentData;
  apiUrl: string;
  /** null = show the conversation. */
  section: AgentSettingsSection | null;
  overlay: ChatOverlay;
  restarting: boolean;
  toggling: boolean;
}>();

const emit = defineEmits<{
  restart: [];
  toggleRunning: [];
  back: [];
  'agent-updated': [IAgentData];
}>();

const sectionMeta = computed(() =>
  AGENT_SETTINGS_SECTIONS.find((s) => s.value === props.section) ?? null,
);
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- Section mode. `v-if` here is deliberate and the opposite of the chat
         branch below: sections should mount fresh and unmount when left,
         which is the remount-on-activate refetch behaviour they had as
         TabsContent. -->
    <template v-if="section">
      <div class="flex shrink-0 items-center gap-2 pb-3">
        <Button variant="ghost" size="sm" class="-ml-2" @click="emit('back')">
          <IconChevronLeft class="size-4" />
          Chat
        </Button>
        <span class="text-muted-foreground/50">/</span>
        <span class="text-sm font-medium">{{ sectionMeta?.title }}</span>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <AgentOverviewTab
          v-if="section === 'overview'"
          :agent="agent"
          :api-url="apiUrl"
          @agent-updated="(updated: IAgentData) => emit('agent-updated', updated)"
        />

        <AgentKnowledgeTab
          v-else-if="section === 'knowledge'"
          :agent="agent"
        />

        <Card v-else-if="section === 'files'">
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

        <Card v-else-if="section === 'secrets'">
          <CardHeader>
            <CardTitle>Secrets</CardTitle>
            <CardDescription>
              User-scoped secrets stored by the agent runtime. Source depends
              on <code>SECRET_PROVIDER</code>:
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

        <AgentEnvTab v-else-if="section === 'env'" :agent-id="agent.id" />

        <AgentChannelProvider
          v-else-if="section === 'channels'"
          :agent-id="agent.id"
        />

        <ChatListProvider v-else-if="section === 'chats'" :agent-id="agent.id" />

        <AgentPaddockTab
          v-else-if="section === 'paddock'"
          :agent-id="agent.id"
        />
      </div>
    </template>

    <!-- Chat mode. `v-show`, NEVER `v-if`: unmounting drops the websocket,
         the transcript, the scroll position and the restart overlay state, so
         returning from a section would cost a reconnect and a refetch
         (SC-004a). Hidden, the chat keeps living behind the open section. -->
    <div v-show="!section" class="min-h-0 flex-1">
      <AgentChatTab
        :agent="agent"
        :api-url="apiUrl"
        :overlay="overlay"
        :restarting="restarting"
        :toggling="toggling"
        @restart="emit('restart')"
        @toggle-running="emit('toggleRunning')"
      />
    </div>
  </div>
</template>
