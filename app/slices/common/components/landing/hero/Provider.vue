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
                {{ format.number(available.length) }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted-foreground">
                {{ $t('hero.stat_running') }}
              </dt>
              <dd class="text-2xl font-semibold">{{ format.number(runningCount) }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted-foreground">
                {{ $t('hero.stat_uptime') }}
              </dt>
              <dd class="text-2xl font-semibold">{{ format.percent(UPTIME) }}</dd>
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
          <div
            v-else
            class="relative h-[520px] rounded-2xl border bg-card shadow-xl overflow-hidden flex items-center justify-center p-8 text-center"
          >
            <div
              class="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-primary/10 blur-3xl pointer-events-none"
            />
            <div class="max-w-sm">
              <div class="font-semibold text-lg">
                {{ $t('hero.no_agent_title') }}
              </div>
              <p class="mt-3 text-sm text-muted-foreground">
                {{ $t('hero.no_agent_lede', { origin }) }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { IAgentData } from '#agent/stores/agent';
import { useFormat } from '#common/composables/useFormat';

const agentStore = useAgentStore();
const authStore = useAuthStore();
const format = useFormat();

/** The uptime shown on the landing page, as a ratio. */
const UPTIME = 0.999;

await useAsyncData('landing-agents', () => agentStore.fetchPublic());

/** The page's own origin, the same on the server and in the browser. */
const origin = useRequestURL().origin;

/**
 * Only the agents the hub would actually let an anonymous visitor talk to
 * from this page: public, and this origin on their allowed list. Previewing
 * any other agent ends in ORIGIN_NOT_ALLOWED in the middle of the landing
 * page, and a made-up demo card is not an honest substitute (CLEAN-179).
 */
const available = computed<IAgentData[]>(() =>
  agentStore.publicAgents.filter((a) => a.allowedOrigins.includes(origin)),
);

const featured = computed<IAgentData | null>(
  () => available.value[0] ?? null,
);

const runningCount = computed(
  () => available.value.filter((a) => a.status === 'running').length,
);

const canDeployAgent = computed(() =>
  authStore.hasRole(UserRoleTypes.Owner, UserRoleTypes.Admin),
);
</script>
