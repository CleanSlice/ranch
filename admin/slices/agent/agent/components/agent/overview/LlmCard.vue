<script setup lang="ts">
const props = defineProps<{
  agentId: string;
  llmCredentialId: string | null;
}>();

const llmStore = useLlmStore();

const { pending } = useAsyncData(
  'admin-llms-for-agent',
  () => llmStore.fetchAll(),
  { lazy: true },
);

const currentLlm = computed(() =>
  props.llmCredentialId
    ? llmStore.items.find((c) => c.id === props.llmCredentialId) ?? null
    : null,
);
</script>

<template>
  <Card>
    <CardHeader>
      <div class="flex items-start justify-between gap-3">
        <div>
          <CardTitle>LLM</CardTitle>
          <CardDescription>
            Credential the agent uses for completions. Switch in the
            <NuxtLink :to="`/agents/${agentId}/edit`" class="underline">edit</NuxtLink>
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
      <div v-if="pending && !currentLlm" class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div v-for="i in 4" :key="i" class="space-y-2">
          <Skeleton class="h-3 w-20" />
          <Skeleton class="h-4 w-32" />
        </div>
      </div>
      <div v-else-if="!currentLlm" class="text-sm text-muted-foreground">
        No LLM credential assigned. Pick one in the
        <NuxtLink :to="`/agents/${agentId}/edit`" class="underline">edit</NuxtLink>
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
</template>
