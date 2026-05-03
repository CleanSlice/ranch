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
import { IconArrowLeft, IconEye, IconEyeOff, IconLoader2, IconRefresh, IconShield, IconShieldOff } from '@tabler/icons-vue';
import { FlaskConical } from 'lucide-vue-next';

const props = defineProps<{ id: string }>();
const agentStore = useAgentStore();
const agentStatusStore = useAgentStatusStore();
const authStore = useAuthStore();
const settingStore = useSettingStore();
const llmStore = useLlmStore();
const usageStore = useUsageStore();
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

const envPending = computed(() => settingsPending.value || llmsPending.value);

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
    { name: 'BRIDLE_BOT_ID', value: agent.value.id },
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
    { name: 'RANCH_API_URL', value: agent.value.isAdmin ? settingValue('ranch_api_url', 'http://api:3001') : '' },
    // Token is minted at deploy time and never echoed back over the API. Show
    // a placeholder so the admin can see the slot exists without leaking the
    // value (which is in the pod env, AWS Secrets Manager, or S3 only).
    { name: 'RANCH_API_TOKEN', value: agent.value.isAdmin ? '<service-token>' : '' },
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
  // Optimistic — flip to "deploying" right away so the badge reacts before
  // the API call resolves (cancel + submit takes a few seconds).
  const previousStatus = agent.value.status;
  agent.value = { ...agent.value, status: 'deploying' };
  try {
    await agentStore.restart(agent.value.id);
    await refresh();
    await refreshUsage();
  } catch (err) {
    if (agent.value) agent.value = { ...agent.value, status: previousStatus };
    restartError.value = (err as Error).message || 'Restart failed';
  } finally {
    restarting.value = false;
  }
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

// ── Pod logs ────────────────────────────────────────────────────────────
const logs = ref<string>('');
const logsLoading = ref(false);
const logsError = ref<string | null>(null);
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

const confirmRemoveOpen = ref(false);

async function onRemove() {
  if (!agent.value) return;
  await agentStore.remove(agent.value.id);
  await navigateTo('/agents');
}

const promoting = ref(false);
const promoteError = ref<string | null>(null);
const confirmPromoteOpen = ref(false);

async function onPromote() {
  if (!agent.value || promoting.value) return;
  promoting.value = true;
  promoteError.value = null;
  try {
    const updated = agent.value.isAdmin
      ? await agentStore.demoteAdmin(agent.value.id)
      : await agentStore.promoteAdmin(agent.value.id);
    agent.value = { ...updated, status: 'deploying' };
    await refresh();
  } catch (err) {
    promoteError.value = (err as Error).message || 'Promote failed';
  } finally {
    promoting.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <NuxtLink to="/agents" class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <IconArrowLeft class="size-4" /> Back to agents
    </NuxtLink>

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
      <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(380px,480px)]">
        <div class="flex flex-col gap-6">
          <Skeleton class="h-44 w-full rounded-lg" />
          <Skeleton class="h-56 w-full rounded-lg" />
          <Skeleton class="h-72 w-full rounded-lg" />
        </div>
        <div class="flex flex-col gap-6">
          <Skeleton class="h-[600px] w-full rounded-lg" />
          <Skeleton class="h-[480px] w-full rounded-lg" />
        </div>
      </div>
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
              <NuxtLink :to="`/agents/${agent.id}/paddock`">
                <FlaskConical class="size-4" />
                Paddock
              </NuxtLink>
            </Button>
            <Button variant="outline" as-child>
              <NuxtLink :to="`/agents/${agent.id}/edit`">Edit</NuxtLink>
            </Button>
            <Button
              variant="outline"
              :disabled="promoting"
              :title="agent.isAdmin
                ? 'Drop ranch_* admin tools and redeploy'
                : 'Grant ranch_* admin tools and redeploy. Clears the flag from any other agent.'"
              @click="agent.isAdmin ? (onPromote()) : (confirmPromoteOpen = true)"
            >
              <IconLoader2 v-if="promoting" class="size-4 animate-spin" />
              <IconShieldOff v-else-if="agent.isAdmin" class="size-4" />
              <IconShield v-else class="size-4" />
              {{ agent.isAdmin ? 'Demote' : 'Promote to admin' }}
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
            <Button variant="ghost" class="text-destructive" @click="confirmRemoveOpen = true">Delete</Button>
          </div>
          <p
            v-if="restartError"
            class="text-xs text-destructive"
          >
            {{ restartError }}
          </p>
          <p
            v-if="promoteError"
            class="text-xs text-destructive"
          >
            {{ promoteError }}
          </p>
        </div>
      </div>

      <ConfirmDialog
        v-model:open="confirmPromoteOpen"
        title="Promote to Ranch admin"
        :description="`Grant ranch_* tools to “${agent.name}” and redeploy with RANCH_ADMIN=true. The flag is cleared from any other admin agent and that agent is also redeployed.`"
        confirm-label="Promote"
        @confirm="onPromote"
      />

      <ConfirmDialog
        v-model:open="confirmRemoveOpen"
        title="Delete agent"
        :description="`Permanently delete agent “${agent.name}”? This cannot be undone.`"
        confirm-label="Delete agent"
        @confirm="onRemove"
      />

      <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(380px,480px)]">
        <div class="flex flex-col gap-6">
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
                  <dd class="mt-1 text-sm text-muted-foreground">{{ agent.templateId }}</dd>
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
        </div>

        <div class="flex flex-col gap-6">
          <BridleProvider
            v-if="authStore.accessToken"
            :api-url="apiUrl"
            :bot-id="agent.id"
            :token="authStore.accessToken"
            :title="`Chat with ${agent.name}`"
            class="h-[600px] w-full max-w-none"
          />

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
                class="max-h-[480px] overflow-auto rounded-md border bg-muted/30 p-3"
              >
                <pre
                  v-if="logs"
                  class="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed"
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
      </div>
    </template>

    <div v-else class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
      Agent not found.
    </div>
  </div>
</template>
