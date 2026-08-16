<script setup lang="ts">
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconLoader2,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconShield,
  IconX,
} from '@tabler/icons-vue';
import { AGENT_TABS, type AgentTab } from './tabs';

const props = defineProps<{ id: string }>();
const agentStore = useAgentStore();
const config = useRuntimeConfig();

const apiUrl =
  (config.public as { apiUrl?: string }).apiUrl ??
  (typeof process !== 'undefined' ? process.env.API_URL : undefined) ??
  'http://localhost:3333';

// Loaded lazily so the route transitions immediately and the skeleton renders
// until the data arrives. Without lazy, top-level awaits in <script setup>
// block the Vue Router transition until every promise resolves — the user
// perceives this as a multi-second delay before the page opens.
const { data: agent, pending, refresh } = useAsyncData(
  `admin-agent-${props.id}`,
  () => agentStore.fetchById(props.id),
  { lazy: true },
);

const {
  isRestarting,
  restartError,
  restart,
  canStop,
  toggling,
  toggleError,
  toggleRunning,
  pendingRestart,
  dismissRestartBanner,
  chatOverlay,
} = useAgentLifecycle(props.id, agent, refresh);

// Tab state — persisted in the URL so deep links + browser back work.
// `chat` is the default since 99% of the time the user is here to talk to the
// agent, not to inspect its plumbing.
const TAB_VALUES = AGENT_TABS.map((t) => t.value);
const route = useRoute();
const router = useRouter();
const activeTab = computed<AgentTab>({
  get: () => {
    const q = route.query.tab;
    return TAB_VALUES.includes(q as AgentTab) ? (q as AgentTab) : 'chat';
  },
  set: (v) => {
    router.replace({ query: { ...route.query, tab: v === 'chat' ? undefined : v } });
  },
});

// The status badge on the overview tab renders from the DB row (not the SSE
// pod stream). Re-fetch on each switch to overview so a stale 'failed' or
// 'deploying' from initial load doesn't outlive the reconciled state. The
// per-card data (usage, metrics, …) refetches by itself: cards remount when
// the tab becomes active.
watch(activeTab, (tab) => {
  if (tab === 'overview') refresh();
});
</script>

<template>
  <div class="flex flex-col gap-6">
    <NuxtLink to="/agents" class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <IconArrowLeft class="size-4" /> Back to agents
    </NuxtLink>

    <div
      v-if="pendingRestart"
      class="flex flex-wrap items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
    >
      <IconAlertTriangle class="size-4 shrink-0" />
      <p class="flex-1 min-w-56">
        Agent settings were updated. Restart the agent to apply the changes.
      </p>
      <div class="flex items-center gap-2">
        <Button size="sm" :disabled="isRestarting" @click="restart">
          <IconRefresh class="size-4" :class="isRestarting && 'animate-spin'" />
          {{ isRestarting ? 'Restarting…' : 'Restart agent' }}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          :disabled="isRestarting"
          @click="dismissRestartBanner"
        >
          <IconX class="size-4" />
        </Button>
      </div>
    </div>

    <!-- Skeleton only on initial load (no agent yet). Subsequent refreshes
         (status polling every 5s during deploy, post-restart refresh) keep
         showing the previous data so the page doesn't flash to "Loading…"
         and back. -->
    <div v-if="pending && !agent" class="flex flex-col gap-6">
      <div class="flex items-start justify-between gap-4">
        <div class="space-y-2">
          <Skeleton class="h-8 w-64" />
          <Skeleton class="h-4 w-72" />
        </div>
        <div class="flex gap-2">
          <Skeleton class="h-9 w-16" />
          <Skeleton class="h-9 w-24" />
          <Skeleton class="h-9 w-16" />
        </div>
      </div>
      <Skeleton class="h-10 w-96 rounded-md" />
      <Skeleton class="h-[480px] w-full rounded-lg" />
    </div>

    <template v-else-if="agent">
      <div class="flex items-start justify-between gap-4">
        <div>
          <div class="flex items-center gap-2">
            <h1 class="text-2xl font-semibold">{{ agent.name }}</h1>
            <Badge v-if="agent.isAdmin" variant="default" class="gap-1">
              <IconShield class="size-3" /> Ranch admin
            </Badge>
          </div>
          <p class="text-sm text-muted-foreground">Agent ID: {{ agent.id }}</p>
        </div>
        <div class="flex flex-col items-end gap-1">
          <div class="flex gap-2">
            <Button variant="outline" as-child>
              <NuxtLink :to="`/agents/${agent.id}/edit`">Edit</NuxtLink>
            </Button>
            <Button
              variant="outline"
              :disabled="toggling || isRestarting"
              :title="canStop ? 'Cancel the workflow and delete the pod to free cluster resources' : 'Deploy a fresh pod'"
              @click="toggleRunning"
            >
              <IconLoader2 v-if="toggling" class="size-4 animate-spin" />
              <IconPlayerStop v-else-if="canStop" class="size-4" />
              <IconPlayerPlay v-else class="size-4" />
              {{
                toggling
                  ? canStop
                    ? 'Stopping…'
                    : 'Starting…'
                  : canStop
                    ? 'Stop'
                    : 'Start'
              }}
            </Button>
            <Button
              variant="outline"
              :disabled="isRestarting || toggling"
              @click="restart"
            >
              <IconLoader2 v-if="isRestarting" class="size-4 animate-spin" />
              <IconRefresh v-else class="size-4" />
              {{ isRestarting ? 'Restarting…' : 'Restart' }}
            </Button>
          </div>
          <p v-if="restartError || toggleError" class="text-xs text-destructive">
            {{ restartError || toggleError }}
          </p>
        </div>
      </div>

      <!-- Full-width usage strip under the header: visible on every tab,
           Details jumps to the Overview tab's full usage card. -->
      <UsagePanel
        :agent-id="agent.id"
        agent-only
        variant="strip"
        class="-my-1"
        @details="activeTab = 'overview'"
      />

      <Tabs
        orientation="vertical"
        :model-value="activeTab"
        class="flex-row gap-8 md:grid md:grid-cols-[16rem_minmax(0,1fr)]"
        @update:model-value="activeTab = $event as AgentTab"
      >
        <TabsList
          class="flex h-auto flex-col items-stretch gap-1 self-start bg-transparent p-0"
        >
          <TabsTrigger
            v-for="t in AGENT_TABS"
            :key="t.value"
            :value="t.value"
            class="group h-auto flex-none justify-start whitespace-normal rounded-md border border-transparent px-3 py-2 text-left text-sm font-normal transition-colors hover:bg-muted data-[state=active]:border-border data-[state=active]:bg-muted data-[state=active]:shadow-none"
          >
            <span class="flex flex-col items-start gap-0.5">
              <span class="font-medium">{{ t.title }}</span>
              <span class="text-xs text-muted-foreground">{{ t.desc }}</span>
            </span>
          </TabsTrigger>
        </TabsList>

        <div class="min-w-0">
          <TabsContent value="chat" class="mt-0">
            <AgentChatTab
              :agent="agent"
              :api-url="apiUrl"
              :overlay="chatOverlay"
              :restarting="isRestarting"
              :toggling="toggling"
              @restart="restart"
              @toggle-running="toggleRunning"
            />
          </TabsContent>

          <TabsContent value="overview" class="mt-0">
            <AgentOverviewTab
              :agent="agent"
              :api-url="apiUrl"
              @agent-updated="(updated) => (agent = updated)"
            />
          </TabsContent>

          <TabsContent value="knowledge" class="mt-0">
            <AgentKnowledgeTab :agent="agent" />
          </TabsContent>

          <TabsContent value="files" class="mt-0">
            <Card>
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
          </TabsContent>

          <TabsContent value="secrets" class="mt-0">
            <Card>
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
          </TabsContent>

          <TabsContent value="env" class="mt-0">
            <AgentEnvTab :agent-id="agent.id" />
          </TabsContent>

          <TabsContent value="channels" class="mt-0">
            <AgentChannelProvider :agent-id="agent.id" />
          </TabsContent>

          <TabsContent value="chats" class="mt-0">
            <ChatListProvider :agent-id="agent.id" />
          </TabsContent>

          <TabsContent value="paddock" class="mt-0">
            <AgentPaddockTab :agent-id="agent.id" />
          </TabsContent>
        </div>
      </Tabs>
    </template>

    <div v-else class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
      Agent not found.
    </div>
  </div>
</template>
