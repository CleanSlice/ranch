<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import { Badge } from '#theme/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';
import { Skeleton } from '#theme/components/ui/skeleton';
import {
  IconShield,
  IconRefresh,
  IconLoader2,
  IconCheck,
  IconCircle,
  IconExternalLink,
  IconTemplate,
  IconBolt,
  IconBrain,
  IconBook2,
  IconActivity,
} from '@tabler/icons-vue';
import { Bot } from 'lucide-vue-next';

const rancherStore = useRancherStore();
const agentStore = useAgentStore();
const agentStatusStore = useAgentStatusStore();
const bridleStore = useBridleStore();
const authStore = useAuthStore();
const llmStore = useLlmStore();
const templateStore = useTemplateStore();
const skillStore = useSkillStore();
const knowledgeStore = useKnowledgeStore();
const usageStore = useUsageStore();
const config = useRuntimeConfig();
const { t } = useI18n();

if (import.meta.client) {
  onMounted(() => agentStatusStore.connect());
  onBeforeUnmount(() => agentStatusStore.disconnect());
}

const apiUrl =
  (config.public as { apiUrl?: string }).apiUrl ??
  (typeof process !== 'undefined' ? process.env.API_URL : undefined) ??
  'http://localhost:3333';

const { data: status, pending, refresh } = useAsyncData(
  'rancher-status',
  () => rancherStore.fetchStatus(),
  { lazy: true },
);

const { data: dashboard, refresh: refreshDashboard } = useAsyncData(
  'rancher-dashboard',
  async () => {
    const [agents, templates, skills, llms, knowledges] = await Promise.all([
      agentStore.fetchAll(),
      templateStore.fetchAll(),
      skillStore.fetchAll(),
      llmStore.fetchAll(),
      knowledgeStore.fetchAll(),
    ]);
    return {
      agents: agents.length,
      templates: templates.length,
      skills: skills.length,
      llms: llms.length,
      llmsActive: llms.filter((l) => l.status === 'active').length,
      knowledges: knowledges.length,
    };
  },
  { lazy: true },
);

const stats = computed(() => [
  {
    label: 'Agents',
    value: dashboard.value?.agents ?? 0,
    href: '/agents',
    icon: Bot,
  },
  {
    label: 'Templates',
    value: dashboard.value?.templates ?? 0,
    href: '/templates',
    icon: IconTemplate,
  },
  {
    label: 'Skills',
    value: dashboard.value?.skills ?? 0,
    href: '/skills',
    icon: IconBolt,
  },
  {
    label: 'LLMs',
    value: dashboard.value?.llms ?? 0,
    hint: dashboard.value
      ? `${dashboard.value.llmsActive} active`
      : undefined,
    href: '/llms',
    icon: IconBrain,
  },
  {
    label: 'Knowledges',
    value: dashboard.value?.knowledges ?? 0,
    href: '/knowledges',
    icon: IconBook2,
  },
]);

const { data: adminUsage, refresh: refreshUsage } = useAsyncData(
  'rancher-admin-usage',
  async () => {
    const adminAgent = await agentStore.fetchAdmin();
    if (!adminAgent) return null;
    return await usageStore.fetchForAgent(adminAgent.id);
  },
  { lazy: true },
);

const usageStats = computed(() => {
  const u = adminUsage.value;
  if (!u) return null;
  const fmt = new Intl.NumberFormat('en-US');
  const cost = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 4,
  });
  return {
    cost30d: cost.format(u.totals.costUsd),
    tokens30d: fmt.format(u.totals.inputTokens + u.totals.outputTokens),
    calls30d: fmt.format(u.totals.callCount),
    callsToday: fmt.format(u.today.callCount),
    topModel: u.topModel ?? '—',
  };
});

async function onRefreshAll() {
  await Promise.all([refresh(), refreshDashboard(), refreshUsage()]);
}

const hasLlm = computed(() => !!status.value?.hasLlm);
const hasTemplate = computed(() => !!status.value?.template);
const admin = computed(() => status.value?.admin ?? null);

const adminConnected = computed(() => {
  const a = admin.value;
  if (!a) return false;
  const pod = agentStatusStore.statuses[a.id];
  if (pod) return pod.phase === 'Running' && pod.ready;
  return a.status === 'running';
});

const fullyConnected = computed(
  () => adminConnected.value && bridleStore.isConnected,
);

if (import.meta.client) {
  let pollHandle: ReturnType<typeof setInterval> | null = null;
  const stop = () => {
    if (pollHandle) {
      clearInterval(pollHandle);
      pollHandle = null;
    }
  };
  watch(
    fullyConnected,
    (isFully) => {
      if (isFully) {
        stop();
      } else if (!pollHandle) {
        pollHandle = setInterval(() => {
          refresh();
        }, 5000);
      }
    },
    { immediate: true },
  );
  onBeforeUnmount(stop);
}

const stepDone = computed(() => ({
  llm: hasLlm.value,
  template: hasTemplate.value,
  agent: !!admin.value,
}));

const allDone = computed(
  () => stepDone.value.llm && stepDone.value.template && stepDone.value.agent,
);

const generatingTemplate = ref(false);
const templateError = ref<string | null>(null);

async function onGenerateTemplate() {
  if (generatingTemplate.value) return;
  generatingTemplate.value = true;
  templateError.value = null;
  try {
    await rancherStore.ensureTemplate();
    await refresh();
  } catch (err) {
    templateError.value =
      (err as Error).message ?? 'Failed to generate template';
  } finally {
    generatingTemplate.value = false;
  }
}

const deploying = ref(false);
const deployError = ref<string | null>(null);

async function onDeploy() {
  if (deploying.value || !status.value?.template) return;
  deploying.value = true;
  deployError.value = null;
  try {
    // Pick the first active LLM. The API check ensures at least one exists,
    // but we re-fetch to make sure the local list is fresh after step 1.
    await llmStore.fetchAll();
    const llm = llmStore.items.find((c) => c.status === 'active');
    if (!llm) throw new Error('No active LLM credential found');
    await agentStore.create({
      name: 'Rancher',
      templateId: status.value.template.id,
      llmCredentialId: llm.id,
      isAdmin: true,
    });
    await refresh();
  } catch (err) {
    deployError.value = (err as Error).message ?? 'Failed to deploy agent';
  } finally {
    deploying.value = false;
  }
}
</script>

<template>
  <div class="flex h-full flex-col gap-6">
    <div class="flex items-start justify-between gap-4">
      <div>
        <div class="flex items-center gap-2">
          <h1 class="text-2xl font-semibold">{{ t('rancher.title') }}</h1>
          <Badge v-if="admin" variant="default" class="gap-1">
            <IconShield class="size-3" /> {{ admin.name }}
          </Badge>
        </div>
        <p class="text-sm text-muted-foreground">
          {{ t('rancher.subtitle') }}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        :disabled="pending"
        @click="onRefreshAll"
      >
        <IconLoader2 v-if="pending" class="size-4 animate-spin" />
        <IconRefresh v-else class="size-4" />
      </Button>
    </div>

    <div class="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-2">
      <!-- LEFT — info tiles, 2 per row inside -->
      <div class="flex flex-col gap-3">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <NuxtLink
            v-for="stat in stats"
            :key="stat.label"
            :to="stat.href"
            class="group rounded-lg border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent/50"
          >
            <div class="flex items-center justify-between gap-3">
              <div class="flex flex-col gap-1">
                <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {{ stat.label }}
                </span>
                <span class="text-2xl font-semibold tabular-nums">{{ stat.value }}</span>
                <span v-if="stat.hint" class="text-xs text-muted-foreground">{{ stat.hint }}</span>
              </div>
              <component
                :is="stat.icon"
                class="size-5 text-muted-foreground transition-colors group-hover:text-primary"
              />
            </div>
          </NuxtLink>

          <div
            v-if="usageStats"
            class="rounded-lg border bg-card p-4"
          >
            <div class="mb-3 flex items-center justify-between gap-2">
              <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Rancher usage · 30d
              </span>
              <IconActivity class="size-5 text-muted-foreground" />
            </div>
            <div class="grid grid-cols-2 gap-x-4 gap-y-2">
              <div class="flex flex-col">
                <span class="text-xs text-muted-foreground">Cost</span>
                <span class="text-lg font-semibold tabular-nums">{{ usageStats.cost30d }}</span>
              </div>
              <div class="flex flex-col">
                <span class="text-xs text-muted-foreground">Tokens</span>
                <span class="text-sm tabular-nums">{{ usageStats.tokens30d }}</span>
              </div>
              <div class="flex flex-col">
                <span class="text-xs text-muted-foreground">Calls</span>
                <span class="text-sm tabular-nums">
                  {{ usageStats.calls30d }}
                  <span class="text-xs text-muted-foreground">({{ usageStats.callsToday }} today)</span>
                </span>
              </div>
              <div class="flex flex-col">
                <span class="text-xs text-muted-foreground">Top model</span>
                <span class="font-mono text-xs">{{ usageStats.topModel }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- RIGHT — wizard or chat -->
      <!-- 12rem = header (3.5rem) + main p-6 top (1.5rem) + page title row
           + gap-6 (1.5rem). The extra 1.5rem subtracts main p-6 bottom so
           the column doesn't push past the layout's bottom padding. -->
      <div class="flex min-h-0 flex-col gap-4 lg:sticky lg:top-6 lg:h-[calc(100svh-13.5rem)] lg:self-start">
        <div v-if="pending && !status" class="flex flex-col gap-4">
          <Skeleton class="h-32 w-full rounded-lg" />
          <Skeleton class="h-32 w-full rounded-lg" />
          <Skeleton class="h-32 w-full rounded-lg" />
        </div>

        <div v-else-if="!allDone" class="flex flex-col gap-4">
      <!-- Step 1 — LLM credential -->
      <Card :class="stepDone.llm ? 'border-primary/40' : ''">
        <CardHeader>
          <div class="flex items-center gap-3">
            <div
              class="flex size-7 items-center justify-center rounded-full border"
              :class="stepDone.llm ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40 text-muted-foreground'"
            >
              <IconCheck v-if="stepDone.llm" class="size-4" />
              <span v-else class="text-xs font-semibold">1</span>
            </div>
            <div class="flex-1">
              <CardTitle class="text-base">Add an LLM credential</CardTitle>
              <CardDescription>
                The Rancher needs an active LLM provider (Claude, DeepSeek, OpenRouter…) to think.
              </CardDescription>
            </div>
            <Badge v-if="stepDone.llm" variant="default">Done</Badge>
            <IconCircle v-else class="size-4 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent v-if="!stepDone.llm">
          <Button as-child>
            <NuxtLink to="/llms/create">
              Open LLMs
              <IconExternalLink class="size-4" />
            </NuxtLink>
          </Button>
        </CardContent>
      </Card>

      <!-- Step 2 — Rancher template -->
      <Card :class="stepDone.template ? 'border-primary/40' : ''">
        <CardHeader>
          <div class="flex items-center gap-3">
            <div
              class="flex size-7 items-center justify-center rounded-full border"
              :class="stepDone.template ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40 text-muted-foreground'"
            >
              <IconCheck v-if="stepDone.template" class="size-4" />
              <span v-else class="text-xs font-semibold">2</span>
            </div>
            <div class="flex-1">
              <CardTitle class="text-base">Generate the Rancher template</CardTitle>
              <CardDescription>
                Special template <code>template-rancher</code>. One click — server-side defaults, editable later in <NuxtLink to="/templates" class="underline">Templates</NuxtLink>.
              </CardDescription>
            </div>
            <Badge v-if="stepDone.template" variant="default">Done</Badge>
            <IconCircle v-else class="size-4 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent v-if="!stepDone.template" class="flex flex-col gap-2">
          <div>
            <Button
              :disabled="!stepDone.llm || generatingTemplate"
              @click="onGenerateTemplate"
            >
              <IconLoader2 v-if="generatingTemplate" class="size-4 animate-spin" />
              {{ generatingTemplate ? 'Generating…' : 'Generate template' }}
            </Button>
          </div>
          <p v-if="!stepDone.llm" class="text-xs text-muted-foreground">
            Complete step 1 first.
          </p>
          <p v-if="templateError" class="text-xs text-destructive">
            {{ templateError }}
          </p>
        </CardContent>
        <CardContent v-else class="text-sm text-muted-foreground">
          <span class="font-mono">{{ status?.template?.name }}</span>
          ·
          <span class="font-mono text-xs">{{ status?.template?.image }}</span>
        </CardContent>
      </Card>

      <!-- Step 3 — Deploy agent -->
      <Card :class="stepDone.agent ? 'border-primary/40' : ''">
        <CardHeader>
          <div class="flex items-center gap-3">
            <div
              class="flex size-7 items-center justify-center rounded-full border"
              :class="stepDone.agent ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40 text-muted-foreground'"
            >
              <IconCheck v-if="stepDone.agent" class="size-4" />
              <span v-else class="text-xs font-semibold">3</span>
            </div>
            <div class="flex-1">
              <CardTitle class="text-base">Deploy the Rancher agent</CardTitle>
              <CardDescription>
                Spawns an agent named <code>Rancher</code> on the template, attaches the LLM, and promotes it to Ranch admin (<code>RANCH_ADMIN=true</code> + service token).
              </CardDescription>
            </div>
            <Badge v-if="stepDone.agent" variant="default">Done</Badge>
            <IconCircle v-else class="size-4 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent v-if="!stepDone.agent" class="flex flex-col gap-2">
          <div>
            <Button
              :disabled="!stepDone.llm || !stepDone.template || deploying"
              @click="onDeploy"
            >
              <IconLoader2 v-if="deploying" class="size-4 animate-spin" />
              {{ deploying ? 'Deploying…' : 'Deploy admin agent' }}
            </Button>
          </div>
          <p v-if="!stepDone.template" class="text-xs text-muted-foreground">
            Complete steps 1 and 2 first.
          </p>
          <p v-if="deployError" class="text-xs text-destructive">
            {{ deployError }}
          </p>
        </CardContent>
      </Card>
    </div>

        <template v-else-if="admin">
          <BridleProvider
            v-if="authStore.accessToken"
            :api-url="apiUrl"
            :bot-id="admin.id"
            :token="authStore.accessToken"
            :title="`Chat with ${admin.name}`"
            :agent-connected="adminConnected"
            class="h-full min-h-0 w-full max-w-none flex-1"
          />
        </template>
      </div>
    </div>
  </div>
</template>
