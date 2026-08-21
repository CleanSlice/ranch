<template>
  <section class="relative overflow-hidden">
    <div
      class="absolute inset-0 -z-10 bg-gradient-to-br from-primary/10 via-transparent to-transparent"
    />
    <div class="container mx-auto px-4 pt-16 pb-24">
      <div class="grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <div
            class="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground mb-6"
          >
            <span class="w-2 h-2 rounded-full bg-green-500" />
            {{ $t('hero.badge') }}
          </div>
          <h1
            class="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.05]"
          >
            {{ $t('hero.title') }}
            <br />
            <span class="text-primary">{{ $t('hero.title_accent') }}</span>
          </h1>
          <p class="mt-6 text-lg text-muted-foreground max-w-xl">
            {{ $t('hero.lede') }}
          </p>

          <div class="mt-8 flex flex-wrap gap-3">
            <NuxtLink
              to="/agents"
              class="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-5 py-3 text-sm font-medium hover:opacity-90 transition"
            >
              {{ $t('hero.cta_dashboard') }}
            </NuxtLink>
            <NuxtLink
              v-if="canDeployAgent"
              to="/agents/create"
              class="inline-flex items-center justify-center rounded-md border px-5 py-3 text-sm font-medium hover:bg-accent transition"
            >
              {{ $t('hero.cta_deploy') }}
            </NuxtLink>
            <NuxtLink
              v-else-if="!authStore.isAuthenticated"
              to="/login"
              class="inline-flex items-center justify-center rounded-md border px-5 py-3 text-sm font-medium hover:bg-accent transition"
            >
              {{ $t('hero.cta_sign_in') }}
            </NuxtLink>
          </div>

          <dl class="mt-10 grid grid-cols-3 gap-6 max-w-md">
            <div>
              <dt class="text-xs text-muted-foreground">
                {{ $t('hero.stat_agents') }}
              </dt>
              <dd class="text-2xl font-semibold">
                {{ agentStore.publicAgents.length }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted-foreground">
                {{ $t('hero.stat_running') }}
              </dt>
              <dd class="text-2xl font-semibold">{{ runningCount }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted-foreground">
                {{ $t('hero.stat_uptime') }}
              </dt>
              <dd class="text-2xl font-semibold">99.9%</dd>
            </div>
          </dl>
        </div>

        <div class="lg:pl-8">
          <div
            v-if="featured"
            class="relative h-[520px] rounded-2xl border bg-card shadow-xl overflow-hidden"
          >
            <div
              class="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-primary/10 blur-3xl pointer-events-none"
            />
            <BridleChatProvider
              :agent-id="featured.id"
              :title="featured.name"
              :subtitle="featured.templateId"
            />
          </div>
          <LandingHeroAgentCard v-else :agent="demoAgent" />
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { IAgentData } from '#agent/stores/agent';

const agentStore = useAgentStore();
const authStore = useAuthStore();

await useAsyncData('landing-agents', () => agentStore.fetchPublic());

const featured = computed<IAgentData | null>(
  () => agentStore.publicAgents[0] ?? null,
);

const runningCount = computed(
  () =>
    agentStore.publicAgents.filter((a) => a.status === 'running').length,
);

const canDeployAgent = computed(() =>
  authStore.hasRole(UserRoleTypes.Owner, UserRoleTypes.Admin),
);

const demoAgent: IAgentData = {
  id: 'demo',
  name: 'Scout',
  status: 'running',
  templateId: 'ranch/scout:latest',
  workflowId: null,
  config: {},
  resources: { cpu: '500m', memory: '512Mi' },
  isPublic: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
</script>
