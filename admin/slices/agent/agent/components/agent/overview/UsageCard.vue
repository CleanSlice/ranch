<script setup lang="ts">
const props = defineProps<{ agentId: string }>();

const usageStore = useUsageStore();

const { data: usage, pending } = useAsyncData(
  `admin-agent-usage-${props.agentId}`,
  () => usageStore.fetchForAgent(props.agentId),
  { lazy: true },
);
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Usage</CardTitle>
      <CardDescription>
        Tokens reported by the agent runtime (<code>usage.json</code>).
        Today first, then 30-day totals across all models.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <div v-if="pending && !usage" class="grid grid-cols-1 gap-4 sm:grid-cols-4">
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
            {{ formatCount(usage.today.inputTokens) }} / {{ formatCount(usage.today.outputTokens) }}
          </dd>
        </div>
        <div>
          <dt class="text-xs text-muted-foreground">Today · calls</dt>
          <dd class="mt-1 font-mono text-sm">{{ usage.today.callCount }}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted-foreground">30d · cost</dt>
          <dd class="mt-1 font-mono text-sm">{{ formatUsd(usage.totals.costUsd) }}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted-foreground">30d · top model</dt>
          <dd class="mt-1 font-mono text-sm">{{ usage.topModel ?? '—' }}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted-foreground">30d · input</dt>
          <dd class="mt-1 font-mono text-sm">{{ formatCount(usage.totals.inputTokens) }}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted-foreground">30d · output</dt>
          <dd class="mt-1 font-mono text-sm">{{ formatCount(usage.totals.outputTokens) }}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted-foreground">30d · calls</dt>
          <dd class="mt-1 font-mono text-sm">{{ usage.totals.callCount }}</dd>
        </div>
      </dl>
    </CardContent>
  </Card>
</template>
