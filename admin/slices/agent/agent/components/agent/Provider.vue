<script setup lang="ts">
import type { AgentStatusTypes } from '#agent/stores/agent';
import { Button } from '#theme/components/ui/button';
import { Badge } from '#theme/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';
import { Checkbox } from '#theme/components/ui/checkbox';
import { Label } from '#theme/components/ui/label';
import { Skeleton } from '#theme/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#theme/components/ui/tabs';
import { IconAlertTriangle, IconArrowLeft, IconEye, IconEyeOff, IconLoader2, IconRefresh, IconShield, IconX } from '@tabler/icons-vue';
import { FileText, X } from 'lucide-vue-next';
import type { IPaddockScenario } from '#paddock/stores/paddockScenario';

const props = defineProps<{ id: string }>();
const agentStore = useAgentStore();
const agentChannelStore = useAgentChannelStore();
const agentStatusStore = useAgentStatusStore();
const authStore = useAuthStore();
const settingStore = useSettingStore();
const llmStore = useLlmStore();
const usageStore = useUsageStore();
const templateStore = useTemplateStore();
// Bridle is the only signal that means "agent is actually talking to us right
// now" — strongest source of truth for the overlay, beats both DB status and
// pod.ready. The chat panel below mounts a BridleProvider that drives this.
const bridleStore = useBridleStore();
const config = useRuntimeConfig();

const apiUrl =
  (config.public as { apiUrl?: string }).apiUrl ??
  (typeof process !== 'undefined' ? process.env.API_URL : undefined) ??
  'http://localhost:3333';

// All async data is loaded lazily so the route transitions immediately and
// each block renders its own skeleton until its data arrives. Without lazy,
// top-level awaits in <script setup> block the Vue Router transition until
// every promise resolves — the user perceives this as a multi-second delay
// before the page opens.
const { data: agent, pending, refresh } = useAsyncData(
  `admin-agent-${props.id}`,
  () => agentStore.fetchById(props.id),
  { lazy: true },
);

const { pending: settingsPending } = useAsyncData(
  'admin-settings-for-agent-env',
  () => settingStore.fetchAll(),
  { lazy: true },
);
const { pending: llmsPending } = useAsyncData(
  'admin-llms-for-agent-env',
  () => llmStore.fetchAll(),
  { lazy: true },
);
const { data: usage, pending: usagePending, refresh: refreshUsage } = useAsyncData(
  `admin-agent-usage-${props.id}`,
  () => usageStore.fetchForAgent(props.id),
  { lazy: true },
);
// Channels live in S3 (agents/{id}/data/channels.json), not on the agent
// row — fetched here so the Env tab can show TELEGRAM_* values that the
// workflow gateway will inject at submit time.
const { data: channels } = useAsyncData(
  `admin-agent-channels-${props.id}`,
  () => agentChannelStore.fetchForAgent(props.id),
  { lazy: true, default: () => [] },
);
const { data: template } = useAsyncData(
  `admin-agent-template-${props.id}`,
  async () => {
    const tplId = agent.value?.templateId;
    if (!tplId) return null;
    return templateStore.fetchById(tplId);
  },
  { lazy: true, watch: [agent] },
);

const envPending = computed(() => settingsPending.value || llmsPending.value);

const currentLlm = computed(() =>
  agent.value?.llmCredentialId
    ? llmStore.items.find((c) => c.id === agent.value!.llmCredentialId) ?? null
    : null,
);

const statusVariant: Record<AgentStatusTypes, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  running: 'default',
  deploying: 'secondary',
  pending: 'secondary',
  stopped: 'outline',
  failed: 'destructive',
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const SECRET_ENV_KEYS = new Set([
  'BRIDLE_API_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'LLM_API_KEY',
  'TELEGRAM_BOT_TOKEN',
]);

const BRIDLE_URL_DEFAULT = 'http://host.k3d.internal:3333/ws/agent';
const BRIDLE_API_KEY_DEFAULT = 'dev-bridle-api-key-change-me';

const envVars = computed<{ name: string; value: string }[]>(() => {
  if (!agent.value) return [];
  const settingValue = (name: string, fallback = '') => {
    const v = settingStore.get('integrations', name)?.value;
    return (typeof v === 'string' && v) || fallback;
  };
  const bucket = settingValue('s3_bucket');
  const cred = agent.value.llmCredentialId
    ? llmStore.items.find((c) => c.id === agent.value!.llmCredentialId) ?? null
    : null;
  return [
    { name: 'AGENT_ID', value: agent.value.id },
    { name: 'AGENT_NAME', value: agent.value.name },
    { name: 'AGENT_CONFIG', value: JSON.stringify(agent.value.config) },
    { name: 'BRIDLE_URL', value: settingValue('bridle_url', BRIDLE_URL_DEFAULT) },
    { name: 'BRIDLE_API_KEY', value: settingValue('bridle_api_key', BRIDLE_API_KEY_DEFAULT) },
    { name: 'BRIDLE_AGENT_ID', value: agent.value.id },
    { name: 'LLM_PROVIDER', value: cred?.provider ?? '' },
    { name: 'LLM_MODEL', value: cred?.model ?? '' },
    { name: 'LLM_FALLBACK_MODEL', value: cred?.fallbackModel ?? cred?.model ?? '' },
    { name: 'LLM_API_KEY', value: cred?.apiKey ?? '' },
    { name: 'S3_BUCKET', value: bucket },
    { name: 'S3_PREFIX', value: bucket ? `agents/${agent.value.id}` : '' },
    {
      name: 'S3_ENDPOINT',
      value:
        settingValue('s3_endpoint_agent') || settingValue('s3_endpoint'),
    },
    { name: 'AWS_REGION', value: settingValue('aws_region', 'us-east-1') },
    { name: 'AWS_ACCESS_KEY_ID', value: settingValue('aws_access_key_id') },
    { name: 'AWS_SECRET_ACCESS_KEY', value: settingValue('aws_secret_access_key') },
    { name: 'SECRET_PROVIDER', value: settingValue('secret_provider', 'file') },
    { name: 'AWS_SECRET_PREFIX', value: settingValue('aws_secret_prefix', 'cleanslice/users') },
    { name: 'RANCH_ADMIN', value: agent.value.isAdmin ? 'true' : 'false' },
    { name: 'RANCH_API_URL', value: agent.value.isAdmin ? settingValue('ranch_api_url', 'http://host.k3d.internal:3333') : '' },
    // Token is minted at deploy time and never echoed back over the API. Show
    // a placeholder so the admin can see the slot exists without leaking the
    // value (which is in the pod env, AWS Secrets Manager, or S3 only).
    { name: 'RANCH_API_TOKEN', value: agent.value.isAdmin ? '<service-token>' : '' },
    // Channels — projected onto runtime env vars by the workflow gateway,
    // sourced from agents/{id}/data/channels.json in S3. Empty values mean
    // the channel isn't configured (runtime skips it).
    {
      name: 'TELEGRAM_BOT_TOKEN',
      value:
        channels.value?.find((c) => c.type === 'telegram')?.config.botToken ??
        '',
    },
    {
      name: 'TELEGRAM_BOT_NAME',
      value:
        channels.value?.find((c) => c.type === 'telegram')?.config.botName ??
        '',
    },
    {
      name: 'TELEGRAM_BOT_ADMIN_IDS',
      value:
        channels.value?.find((c) => c.type === 'telegram')?.config.adminIds ??
        '',
    },
  ];
});

const revealed = ref<Record<string, boolean>>({});
const mask = (v: string) =>
  v ? (v.length <= 6 ? '•'.repeat(v.length) : `${v.slice(0, 3)}${'•'.repeat(Math.max(6, v.length - 6))}${v.slice(-3)}`) : '';

function fmt(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

function fmtUsd(n: number) {
  if (n <= 0) return '$0';
  if (n < 0.01) return '<$0.01';
  return '$' + n.toFixed(2);
}

const restarting = ref(false);
const restartError = ref<string | null>(null);

// Button shows the busy state while the API call is in flight AND while the
// pod is still coming up (status='deploying'). Reverts to idle once the
// AgentStatusService reconciler flips the agent to 'running'.
const isRestarting = computed(
  () => restarting.value || agent.value?.status === 'deploying',
);

async function onRestart() {
  if (!agent.value || isRestarting.value) return;
  restarting.value = true;
  restartError.value = null;
  // Persist BEFORE the API call so an F5 in the next 1–3 sec (while the
  // server is still cancelling the old workflow and hasn't yet written
  // status='deploying') still shows the overlay.
  agentStore.markRestartInFlight(agent.value.id);
  // Optimistic — flip to "deploying" right away so the badge reacts before
  // the API call resolves (cancel + submit takes a few seconds).
  const previousStatus = agent.value.status;
  agent.value = { ...agent.value, status: 'deploying' };
  try {
    await agentStore.restart(agent.value.id);
    agentStore.clearPendingRestart(agent.value.id);
    await refresh();
    await refreshUsage();
  } catch (err) {
    if (agent.value) agent.value = { ...agent.value, status: previousStatus };
    agentStore.clearRestartInFlight(props.id);
    restartError.value = (err as Error).message || 'Restart failed';
  } finally {
    restarting.value = false;
  }
}

const pendingRestart = computed(() => agentStore.isPendingRestart(props.id));

function dismissRestartBanner() {
  agentStore.clearPendingRestart(props.id);
}

// ── Live pod state from SSE ─────────────────────────────────────────────
// Lets the user watch sub-second pod transitions (Pending → ContainerCreating
// → Running) instead of waiting on the 5s status poll below.
onMounted(() => agentStatusStore.connect());
onBeforeUnmount(() => agentStatusStore.disconnect());

const podStatus = computed(() => agentStatusStore.statuses[props.id] ?? null);

const podPhaseLabel = computed(() => {
  const pod = podStatus.value;
  if (!pod) return null;
  if (pod.containerWaitingReason) return pod.containerWaitingReason;
  if (pod.phase === 'Running' && !pod.ready) return 'Starting…';
  if (pod.phase === 'Running' && pod.ready) return 'Ready';
  return pod.phase;
});

// Combined "agent is not ready for chat" overlay state. Falls out of the
// reconciled DB status plus the live pod readiness flag (the same two signals
// AgentStatusService merges) — gives the user a clear "starting…" indication
// during the seconds-long gap between Restart click and the chat WS
// reconnecting. Returns null when chat is fully usable.
type ChatOverlay =
  | { kind: 'starting'; title: string; detail: string }
  | { kind: 'failed'; title: string; detail: string }
  | null;

const chatOverlay = computed<ChatOverlay>(() => {
  if (!agent.value) return null;
  const s = agent.value.status;
  const pod = podStatus.value;
  // localStorage-backed — survives F5 during the seconds-long window between
  // Restart click and the API writing status='deploying'.
  const inFlight = agentStore.isRestartInFlight(props.id);
  // Strongest "agent is up" signal: chat WS is connected AND the runtime is
  // registered with the hub. This bypasses DB/pod entirely — if the agent is
  // actually talking to us, nothing else matters.
  const chatLive = bridleStore.isConnected && bridleStore.isAgentConnected;

  if (chatLive) return null;

  if (s === 'failed') {
    return {
      kind: 'failed',
      title: 'Agent failed to start',
      detail:
        pod?.message ??
        pod?.containerWaitingReason ??
        'Pod did not come up. Check logs and restart.',
    };
  }

  if (s === 'pending' || s === 'deploying' || inFlight) {
    return {
      kind: 'starting',
      title: 'Starting agent…',
      detail: pod
        ? `Pod ${pod.podName}: ${podPhaseLabel.value ?? pod.phase}`
        : 'Cancelling old workflow and submitting a fresh one.',
    };
  }

  // status='running' but pod still not Ready — brief window right after the
  // reconciler flipped the DB but before the readiness probe passes.
  if (s === 'running' && pod && !pod.ready) {
    return {
      kind: 'starting',
      title: 'Starting agent…',
      detail: podPhaseLabel.value ?? 'Waiting for container readiness',
    };
  }

  return null;
});

// Clear the persisted in-flight flag once we have ANY confirmation the agent
// is back: bridle chat live, status=running+pod ready, or terminal failure.
// Bridle is the primary trigger — it fires before the K8s probe can pass.
watch(
  () =>
    [
      agent.value?.status,
      podStatus.value?.ready,
      bridleStore.isConnected,
      bridleStore.isAgentConnected,
    ] as const,
  ([status, ready, chatConnected, agentConnected]) => {
    const chatLive = chatConnected && agentConnected;
    if (chatLive || (status === 'running' && ready === true)) {
      agentStore.clearRestartInFlight(props.id);
    } else if (status === 'failed') {
      agentStore.clearRestartInFlight(props.id);
    }
  },
);

// ── Pod logs ────────────────────────────────────────────────────────────
const logs = ref<string>('');
const logsLoading = ref(false);
const logsError = ref<string | null>(null);

// Backend returns `[container <reason>]` (e.g., "containercreating",
// "podinitializing") instead of the cryptic K8s 400 when the pod exists but
// the container hasn't booted yet. Detect that shape so we can render a
// spinner+message instead of a literal "[container containercreating]" line.
const containerWaitingReason = computed(() => {
  const m = logs.value.trim().match(/^\[container ([a-z0-9_]+)\]$/i);
  return m?.[1] ?? null;
});
const containerWaitingLabel = computed(() => {
  const r = containerWaitingReason.value;
  if (!r) return null;
  // Camel-case the K8s reason for display: containercreating → ContainerCreating
  // (k8s sends it CamelCase originally; backend lowercases it for the marker).
  if (r === 'containercreating') return 'Container creating';
  if (r === 'podinitializing') return 'Pod initializing';
  return r.replace(/\b\w/g, (c) => c.toUpperCase());
});
const logsAutoRefresh = ref(true);
const logsScrollRef = ref<HTMLElement | null>(null);
let logsTimer: ReturnType<typeof setInterval> | null = null;

async function refreshLogs() {
  if (!agent.value) return;
  logsLoading.value = true;
  logsError.value = null;
  try {
    logs.value = await agentStore.fetchLogs(agent.value.id);
    await nextTick();
    if (logsScrollRef.value) {
      logsScrollRef.value.scrollTop = logsScrollRef.value.scrollHeight;
    }
  } catch (err) {
    logsError.value = (err as Error).message || 'Failed to fetch logs';
  } finally {
    logsLoading.value = false;
  }
}

watch(
  logsAutoRefresh,
  (on) => {
    if (logsTimer) {
      clearInterval(logsTimer);
      logsTimer = null;
    }
    if (on) {
      logsTimer = setInterval(refreshLogs, 5000);
    }
  },
  { immediate: true },
);

onMounted(() => {
  if (agent.value) refreshLogs();
});

onBeforeUnmount(() => {
  if (logsTimer) clearInterval(logsTimer);
  if (statusTimer) clearInterval(statusTimer);
});

// ── Status polling while deploying ──────────────────────────────────────
// Backend syncStatus runs on each fetchById; refreshing pulls the latest
// workflow phase. Stop as soon as the agent reaches a terminal state.
let statusTimer: ReturnType<typeof setInterval> | null = null;
const POLL_STATUSES: ReadonlySet<AgentStatusTypes> = new Set(['pending', 'deploying']);

watch(
  () => agent.value?.status,
  (status) => {
    if (status && POLL_STATUSES.has(status)) {
      if (!statusTimer) statusTimer = setInterval(refresh, 5000);
    } else if (statusTimer) {
      clearInterval(statusTimer);
      statusTimer = null;
    }
  },
  { immediate: true },
);

// Side-by-side logs panel on the chat tab. Convenience for watching the agent
// process a message without leaving the chat — separate from the dedicated
// Logs tab, which is the full-width view for log-focused work.
const showSideLogs = ref(false);

// ── Paddock tab state ───────────────────────────────────────────────────
const paddockScenarioListRef = ref<{ refresh: () => Promise<void> } | null>(null);
const paddockEvalListRef = ref<{ refresh: () => Promise<void> } | null>(null);
const paddockFormOpen = ref(false);
const paddockEditing = ref<IPaddockScenario | null>(null);

function onPaddockCreate() {
  paddockEditing.value = null;
  paddockFormOpen.value = true;
}

function onPaddockEdit(scenario: IPaddockScenario) {
  paddockEditing.value = scenario;
  paddockFormOpen.value = true;
}

async function onPaddockScenarioSaved() {
  await paddockScenarioListRef.value?.refresh();
}

async function onPaddockEvalStarted() {
  await paddockEvalListRef.value?.refresh();
}

// Tab state — persisted in the URL so deep links + browser back work.
// `chat` is the default since 99% of the time the user is here to talk to the
// agent, not to inspect its plumbing.
const TABS = ['chat', 'overview', 'files', 'secrets', 'env', 'channels', 'logs', 'paddock'] as const;
type AgentTab = (typeof TABS)[number];
const route = useRoute();
const router = useRouter();
const activeTab = computed<AgentTab>({
  get: () => {
    const q = route.query.tab;
    return TABS.includes(q as AgentTab) ? (q as AgentTab) : 'chat';
  },
  set: (v) => {
    router.replace({ query: { ...route.query, tab: v === 'chat' ? undefined : v } });
  },
});

// Status badge on the overview tab is rendered from the DB row (not the SSE
// pod stream). Re-fetch on each switch to overview so a stale 'failed' or
// 'deploying' from initial load doesn't outlive the actual reconciled state.
// useAsyncData already covers the initial mount → not immediate.
watch(activeTab, (tab) => {
  if (tab === 'overview') {
    refresh();
    refreshUsage();
  }
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
        <Button
          size="sm"
          :disabled="isRestarting"
          @click="onRestart"
        >
          <IconRefresh
            class="size-4"
            :class="isRestarting && 'animate-spin'"
          />
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
              :disabled="isRestarting"
              @click="onRestart"
            >
              <IconLoader2
                v-if="isRestarting"
                class="size-4 animate-spin"
              />
              <IconRefresh v-else class="size-4" />
              {{ isRestarting ? 'Restarting…' : 'Restart' }}
            </Button>
          </div>
          <p
            v-if="restartError"
            class="text-xs text-destructive"
          >
            {{ restartError }}
          </p>
        </div>
      </div>

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
            v-for="t in [
              { value: 'chat', title: 'Chat', desc: 'Talk to the agent.' },
              { value: 'overview', title: 'Overview', desc: 'Usage, runtime, visibility & embed.' },
              { value: 'files', title: 'Files', desc: 'Browse and edit S3-stored agent data.' },
              { value: 'secrets', title: 'Secrets', desc: 'User-scoped secrets the runtime stores.' },
              { value: 'env', title: 'Environment', desc: 'Env vars injected at deploy time.' },
              { value: 'channels', title: 'Channels', desc: 'Messaging platforms (Telegram, …) the agent talks on.' },
              { value: 'logs', title: 'Logs', desc: 'Pod logs from the runtime container.' },
              { value: 'paddock', title: 'Paddock', desc: 'Run evaluations & manage scenarios.' },
            ]"
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
          <div class="flex items-center justify-center gap-3">
            <div
              v-if="authStore.accessToken"
              class="relative h-[calc(100vh-15.5rem)] min-h-[480px] w-full min-w-[400px] max-w-[800px] basis-1/2"
            >
              <BridleProvider
                :api-url="apiUrl"
                :agent-id="agent.id"
                :token="authStore.accessToken"
                :title="`Chat with ${agent.name}`"
                class="h-full w-full"
              />
              <Transition
                enter-active-class="transition-opacity duration-200"
                leave-active-class="transition-opacity duration-200"
                enter-from-class="opacity-0"
                leave-to-class="opacity-0"
              >
                <div
                  v-if="chatOverlay"
                  class="pointer-events-auto absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 rounded-xl bg-background/85 backdrop-blur-sm"
                >
                  <IconLoader2
                    v-if="chatOverlay.kind === 'starting'"
                    class="size-10 animate-spin text-primary"
                  />
                  <IconAlertTriangle
                    v-else
                    class="size-10 text-destructive"
                  />
                  <div class="max-w-sm text-center">
                    <p class="text-sm font-medium">{{ chatOverlay.title }}</p>
                    <p class="mt-1 text-xs text-muted-foreground">
                      {{ chatOverlay.detail }}
                    </p>
                  </div>
                  <Button
                    v-if="chatOverlay.kind === 'failed'"
                    size="sm"
                    :disabled="isRestarting"
                    @click="onRestart"
                  >
                    <IconLoader2
                      v-if="isRestarting"
                      class="size-4 animate-spin"
                    />
                    <IconRefresh v-else class="size-4" />
                    {{ isRestarting ? 'Restarting…' : 'Restart agent' }}
                  </Button>
                </div>
              </Transition>
            </div>
            <Button
              variant="outline"
              size="icon"
              class="shrink-0"
              :class="showSideLogs ? 'bg-muted' : ''"
              :title="showSideLogs ? 'Hide logs' : 'Show logs'"
              :aria-pressed="showSideLogs"
              @click="showSideLogs = !showSideLogs"
            >
              <FileText class="size-4" />
            </Button>
            <Card
              v-if="showSideLogs"
              class="flex h-[calc(100vh-15.5rem)] min-h-[480px] w-full min-w-[400px] max-w-[800px] basis-1/2 flex-col gap-0"
            >
                <CardHeader class="flex flex-row items-center justify-between gap-2 space-y-0 border-b pb-3">
                  <div class="flex items-center gap-2">
                    <CardTitle class="text-sm font-semibold">Logs</CardTitle>
                    <Label
                      for="chat-logs-auto"
                      class="flex items-center gap-1.5 text-xs font-normal text-muted-foreground"
                    >
                      <Checkbox id="chat-logs-auto" v-model="logsAutoRefresh" />
                      Auto 5s
                    </Label>
                  </div>
                  <div class="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      class="h-7 px-2"
                      :disabled="logsLoading"
                      @click="refreshLogs"
                    >
                      <IconRefresh
                        class="size-4"
                        :class="{ 'animate-spin': logsLoading }"
                      />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      class="h-7 px-2"
                      title="Hide logs panel"
                      @click="showSideLogs = false"
                    >
                      <X class="size-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent class="flex-1 overflow-hidden p-0">
                  <div
                    v-if="logsError"
                    class="m-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
                  >
                    {{ logsError }}
                  </div>
                  <div class="h-full overflow-auto bg-muted/30 p-3">
                    <div
                      v-if="containerWaitingLabel"
                      class="flex flex-col items-center gap-2 py-8 text-center text-xs text-muted-foreground"
                    >
                      <IconLoader2 class="size-5 animate-spin text-primary" />
                      <span>{{ containerWaitingLabel }}…</span>
                      <span class="text-[10px]">Logs will appear when the container starts.</span>
                    </div>
                    <pre
                      v-else-if="logs"
                      class="whitespace-pre-wrap wrap-break-word font-mono text-xs leading-relaxed"
                    >{{ logs }}</pre>
                    <div
                      v-else-if="logsLoading"
                      class="py-8 text-center text-xs text-muted-foreground"
                    >
                      Loading…
                    </div>
                    <div
                      v-else
                      class="py-8 text-center text-xs text-muted-foreground"
                    >
                      No logs yet.
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
        </TabsContent>

        <TabsContent value="overview" class="mt-0 flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Usage</CardTitle>
              <CardDescription>
                Tokens reported by the agent runtime (<code>usage.json</code>).
                Today first, then 30-day totals across all models.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div v-if="usagePending && !usage" class="grid grid-cols-1 gap-4 sm:grid-cols-4">
                <div v-for="i in 8" :key="i" class="space-y-2">
                  <Skeleton class="h-3 w-20" />
                  <Skeleton class="h-4 w-24" />
                </div>
              </div>
              <div v-else-if="!usage || usage.totals.callCount === 0" class="text-sm text-muted-foreground">
                No usage reported yet.
              </div>
              <dl v-else class="grid grid-cols-1 gap-4 sm:grid-cols-4">
                <div>
                  <dt class="text-xs text-muted-foreground">Today · model</dt>
                  <dd class="mt-1 font-mono text-sm">{{ usage.today.model ?? '—' }}</dd>
                </div>
                <div>
                  <dt class="text-xs text-muted-foreground">Today · in / out</dt>
                  <dd class="mt-1 font-mono text-sm">
                    {{ fmt(usage.today.inputTokens) }} / {{ fmt(usage.today.outputTokens) }}
                  </dd>
                </div>
                <div>
                  <dt class="text-xs text-muted-foreground">Today · calls</dt>
                  <dd class="mt-1 font-mono text-sm">{{ usage.today.callCount }}</dd>
                </div>
                <div>
                  <dt class="text-xs text-muted-foreground">30d · cost</dt>
                  <dd class="mt-1 font-mono text-sm">{{ fmtUsd(usage.totals.costUsd) }}</dd>
                </div>
                <div>
                  <dt class="text-xs text-muted-foreground">30d · top model</dt>
                  <dd class="mt-1 font-mono text-sm">{{ usage.topModel ?? '—' }}</dd>
                </div>
                <div>
                  <dt class="text-xs text-muted-foreground">30d · input</dt>
                  <dd class="mt-1 font-mono text-sm">{{ fmt(usage.totals.inputTokens) }}</dd>
                </div>
                <div>
                  <dt class="text-xs text-muted-foreground">30d · output</dt>
                  <dd class="mt-1 font-mono text-sm">{{ fmt(usage.totals.outputTokens) }}</dd>
                </div>
                <div>
                  <dt class="text-xs text-muted-foreground">30d · calls</dt>
                  <dd class="mt-1 font-mono text-sm">{{ usage.totals.callCount }}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div class="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>LLM</CardTitle>
                  <CardDescription>
                    Credential the agent uses for completions. Switch in the
                    <NuxtLink :to="`/agents/${agent.id}/edit`" class="underline">edit</NuxtLink>
                    page or manage credentials in
                    <NuxtLink to="/llms" class="underline">LLMs</NuxtLink>.
                  </CardDescription>
                </div>
                <Button v-if="currentLlm" variant="outline" size="sm" as-child>
                  <NuxtLink :to="`/llms/${currentLlm.id}/edit`">Manage</NuxtLink>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div v-if="llmsPending && !currentLlm" class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div v-for="i in 4" :key="i" class="space-y-2">
                  <Skeleton class="h-3 w-20" />
                  <Skeleton class="h-4 w-32" />
                </div>
              </div>
              <div v-else-if="!currentLlm" class="text-sm text-muted-foreground">
                No LLM credential assigned. Pick one in the
                <NuxtLink :to="`/agents/${agent.id}/edit`" class="underline">edit</NuxtLink>
                page.
              </div>
              <dl v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <dt class="text-xs text-muted-foreground">Provider</dt>
                  <dd class="mt-1 text-sm font-medium capitalize">{{ currentLlm.provider }}</dd>
                </div>
                <div>
                  <dt class="text-xs text-muted-foreground">Model</dt>
                  <dd class="mt-1 font-mono text-sm">{{ currentLlm.model }}</dd>
                </div>
                <div v-if="currentLlm.fallbackModel">
                  <dt class="text-xs text-muted-foreground">Fallback model</dt>
                  <dd class="mt-1 font-mono text-sm">{{ currentLlm.fallbackModel }}</dd>
                </div>
                <div v-if="currentLlm.label">
                  <dt class="text-xs text-muted-foreground">Label</dt>
                  <dd class="mt-1 text-sm">{{ currentLlm.label }}</dd>
                </div>
                <div>
                  <dt class="text-xs text-muted-foreground">Status</dt>
                  <dd class="mt-1">
                    <Badge
                      :variant="currentLlm.status === 'active' ? 'default' : 'outline'"
                      class="capitalize"
                    >
                      {{ currentLlm.status }}
                    </Badge>
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

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
                    <Badge :variant="statusVariant[agent.status]" class="capitalize">{{ agent.status }}</Badge>
                    <span
                      v-if="podPhaseLabel"
                      class="text-xs text-muted-foreground"
                      :title="podStatus?.message ?? ''"
                    >
                      pod: {{ podPhaseLabel }}<span v-if="podStatus && podStatus.restartCount > 0">
                        · restarts {{ podStatus.restartCount }}</span>
                    </span>
                  </dd>
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
                      {{ template?.name || agent.templateId }}
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
                  <dd class="mt-1 text-sm">{{ formatDate(agent.createdAt) }}</dd>
                </div>
                <div>
                  <dt class="text-xs text-muted-foreground">Updated</dt>
                  <dd class="mt-1 text-sm">{{ formatDate(agent.updatedAt) }}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <AgentVisibilityProvider
            :agent-id="agent.id"
            :api-url="apiUrl"
            :is-public="agent.isPublic"
            :allowed-origins="agent.allowedOrigins"
            @saved="(updated) => (agent = updated)"
          />
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
          <Card>
            <CardHeader>
              <CardTitle>Environment</CardTitle>
              <CardDescription>
                Env vars injected into the pod at submit time. <code>LLM_*</code>
                comes from the credential assigned to this agent (manage in
                <NuxtLink to="/llms" class="underline">LLMs</NuxtLink>);
                integration values from
                <NuxtLink to="/settings" class="underline">Settings</NuxtLink>.
                Restart the agent to apply changes.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div v-if="envPending" class="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
                <template v-for="i in 8" :key="i">
                  <Skeleton class="h-3 w-32" />
                  <Skeleton class="h-3 w-full max-w-md" />
                  <div />
                </template>
              </div>
              <dl v-else class="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
                <template v-for="env in envVars" :key="env.name">
                  <dt class="font-mono text-xs text-muted-foreground">{{ env.name }}</dt>
                  <dd class="min-w-0 break-all font-mono text-xs">
                    <template v-if="!env.value">
                      <span class="italic text-muted-foreground">not set</span>
                    </template>
                    <template v-else-if="SECRET_ENV_KEYS.has(env.name) && !revealed[env.name]">
                      {{ mask(env.value) }}
                    </template>
                    <template v-else>
                      {{ env.value }}
                    </template>
                  </dd>
                  <dd v-if="SECRET_ENV_KEYS.has(env.name) && env.value" class="flex justify-end">
                    <button
                      type="button"
                      class="text-muted-foreground hover:text-foreground"
                      :title="revealed[env.name] ? 'Hide' : 'Show'"
                      @click="revealed[env.name] = !revealed[env.name]"
                    >
                      <IconEyeOff v-if="revealed[env.name]" class="size-4" />
                      <IconEye v-else class="size-4" />
                    </button>
                  </dd>
                  <dd v-else />
                </template>
              </dl>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="channels" class="mt-0">
          <AgentChannelProvider :agent-id="agent.id" />
        </TabsContent>

        <TabsContent value="logs" class="mt-0">
          <Card>
            <CardHeader>
              <div class="flex items-start justify-between gap-2">
                <div>
                  <CardTitle>Logs</CardTitle>
                </div>
                <div class="flex items-center gap-2">
                  <Label for="logs-auto-refresh" class="text-xs text-muted-foreground font-normal">
                    <Checkbox id="logs-auto-refresh" v-model="logsAutoRefresh" />
                    Auto 5s
                  </Label>
                  <Button
                    size="sm"
                    variant="outline"
                    :disabled="logsLoading"
                    @click="refreshLogs"
                  >
                    <IconRefresh
                      class="size-4"
                      :class="{ 'animate-spin': logsLoading }"
                    />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div
                v-if="logsError"
                class="mb-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
              >
                {{ logsError }}
              </div>
              <div
                ref="logsScrollRef"
                class="max-h-[calc(100vh-21.5rem)] min-h-[480px] overflow-auto rounded-md border bg-muted/30 p-3"
              >
                <div
                  v-if="containerWaitingLabel"
                  class="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground"
                >
                  <IconLoader2 class="size-6 animate-spin text-primary" />
                  <span class="font-medium">{{ containerWaitingLabel }}…</span>
                  <span class="text-xs">Logs will appear when the container starts.</span>
                </div>
                <pre
                  v-else-if="logs"
                  class="whitespace-pre-wrap wrap-break-word font-mono text-xs leading-relaxed"
                >{{ logs }}</pre>
                <div
                  v-else-if="logsLoading"
                  class="py-8 text-center text-xs text-muted-foreground"
                >
                  Loading…
                </div>
                <div
                  v-else
                  class="py-8 text-center text-xs text-muted-foreground"
                >
                  No logs yet.
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="paddock" class="mt-0 flex flex-col gap-6">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h2 class="text-lg font-semibold">Paddock</h2>
              <p class="text-sm text-muted-foreground">
                Run evaluations and manage agent-specific scenario overrides.
              </p>
            </div>
            <PaddockEvaluationRunProvider
              :agent-id="agent.id"
              @started="onPaddockEvalStarted"
            />
          </div>

          <PaddockEvaluationListProvider
            ref="paddockEvalListRef"
            :agent-id="agent.id"
          />

          <PaddockScenarioListProvider
            ref="paddockScenarioListRef"
            :agent-id="agent.id"
            @create="onPaddockCreate"
            @edit="onPaddockEdit"
          />

          <PaddockScenarioFormProvider
            v-model:open="paddockFormOpen"
            :agent-id="agent.id"
            :scenario="paddockEditing"
            @saved="onPaddockScenarioSaved"
          />
        </TabsContent>
        </div>
      </Tabs>
    </template>

    <div v-else class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
      Agent not found.
    </div>
  </div>
</template>
