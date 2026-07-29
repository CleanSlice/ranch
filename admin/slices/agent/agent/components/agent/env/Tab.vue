<script setup lang="ts">
import { IconEye, IconEyeOff } from '@tabler/icons-vue';

const props = defineProps<{ agentId: string }>();

const agentStore = useAgentStore();

// Env preview comes from the API (GET /agents/:id/env), which builds it with
// the SAME code as the real pod manifest — so this panel can never drift from
// what the pod actually receives.
const { data: envVars, pending } = useAsyncData(
  `admin-agent-env-${props.agentId}`,
  () => agentStore.fetchEnv(props.agentId),
  { lazy: true, default: () => [] },
);

const SECRET_ENV_KEYS = new Set([
  'BRIDLE_API_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'LLM_API_KEY',
  'TELEGRAM_BOT_TOKEN',
]);

const revealed = ref<Record<string, boolean>>({});
</script>

<template>
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
      <div v-if="pending" class="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
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
              {{ maskSecret(env.value) }}
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
</template>
