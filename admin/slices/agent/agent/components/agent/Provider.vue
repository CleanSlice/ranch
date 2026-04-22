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
import { IconArrowLeft, IconEye, IconEyeOff, IconRefresh } from '@tabler/icons-vue';

const props = defineProps<{ id: string }>();
const agentStore = useAgentStore();
const authStore = useAuthStore();
const settingStore = useSettingStore();
const llmStore = useLlmStore();
const usageStore = useUsageStore();
const config = useRuntimeConfig();

const apiUrl =
  (config.public as { apiUrl?: string }).apiUrl ??
  (typeof process !== 'undefined' ? process.env.API_URL : undefined) ??
  'http://localhost:3333';

const { data: agent, pending, refresh } = await useAsyncData(
  `admin-agent-${props.id}`,
  () => agentStore.fetchById(props.id),
);

await useAsyncData('admin-settings-for-agent-env', () => settingStore.fetchAll());
await useAsyncData('admin-llms-for-agent-env', () => llmStore.fetchAll());
const { data: usage, refresh: refreshUsage } = await useAsyncData(
  `admin-agent-usage-${props.id}`,
  () => usageStore.fetchForAgent(props.id),
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
]);

const BRIDLE_URL_DEFAULT = 'http://host.k3d.internal:3333';
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
    { name: 'S3_ENDPOINT', value: settingValue('s3_endpoint') },
    { name: 'AWS_REGION', value: settingValue('aws_region', 'us-east-1') },
    { name: 'AWS_ACCESS_KEY_ID', value: settingValue('aws_access_key_id') },
    { name: 'AWS_SECRET_ACCESS_KEY', value: settingValue('aws_secret_access_key') },
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

async function onRestart() {
  if (!agent.value) return;
  await agentStore.restart(agent.value.id);
  await refresh();
  await refreshUsage();
}

// ── Pod logs ────────────────────────────────────────────────────────────
const logs = ref<string>('');
const logsLoading = ref(false);
const logsError = ref<string | null>(null);
const logsAutoRefresh = ref(false);
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

watch(logsAutoRefresh, (on) => {
  if (logsTimer) {
    clearInterval(logsTimer);
    logsTimer = null;
  }
  if (on) {
    logsTimer = setInterval(refreshLogs, 5000);
  }
});

onMounted(() => {
  if (agent.value) refreshLogs();
});

onBeforeUnmount(() => {
  if (logsTimer) clearInterval(logsTimer);
});

async function onRemove() {
  if (!agent.value) return;
  await agentStore.remove(agent.value.id);
  await navigateTo('/agents');
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <NuxtLink to="/agents" class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <IconArrowLeft class="size-4" /> Back to agents
    </NuxtLink>

    <div v-if="pending" class="text-sm text-muted-foreground">Loading…</div>

    <template v-else-if="agent">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold">{{ agent.name }}</h1>
          <p class="text-sm text-muted-foreground">Agent ID: {{ agent.id }}</p>
        </div>
        <div class="flex gap-2">
          <Button variant="outline" as-child>
            <NuxtLink :to="`/agents/${agent.id}/edit`">Edit</NuxtLink>
          </Button>
          <Button variant="outline" @click="onRestart">Restart</Button>
          <Button variant="ghost" class="text-destructive" @click="onRemove">Delete</Button>
        </div>
      </div>

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
              <div v-if="!usage || usage.totals.callCount === 0" class="text-sm text-muted-foreground">
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
                  <dd class="mt-1">
                    <Badge :variant="statusVariant[agent.status]" class="capitalize">{{ agent.status }}</Badge>
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
              <dl class="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
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
                  <CardDescription>
                    Last 500 lines from the agent pod
                    (<code>kubectl logs agent-{{ agent.id.slice(0, 8) }}…</code>).
                  </CardDescription>
                </div>
                <div class="flex items-center gap-2">
                  <label class="flex items-center gap-1 text-xs text-muted-foreground">
                    <input
                      v-model="logsAutoRefresh"
                      type="checkbox"
                      class="size-3.5"
                    />
                    Auto 5s
                  </label>
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
