<script setup lang="ts">
import { IconRefresh } from '@tabler/icons-vue';

const props = defineProps<{ agentId: string }>();

const agentStore = useAgentStore();

const { data: metrics, pending, refresh } = useAsyncData(
  `admin-agent-metrics-${props.agentId}`,
  () => agentStore.fetchMetrics(props.agentId),
  { lazy: true },
);

// metrics-server samples on a ~15s window — 10s polling gives near-live
// numbers without hammering the API. The card only exists while the Overview
// tab is mounted, so the interval dies with it.
let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  timer = setInterval(() => refresh(), 10_000);
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});

const diskUsed = computed(() =>
  metrics.value
    ? metrics.value.node.diskCapacityBytes - metrics.value.node.diskAvailBytes
    : 0,
);
</script>

<template>
  <Card>
    <CardHeader>
      <div class="flex items-start justify-between gap-3">
        <div>
          <CardTitle>Resource usage</CardTitle>
          <CardDescription>
            Live pod CPU / memory (metrics-server) and free disk on the
            K8s node hosting the pod. Refreshes every 10 seconds.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" :disabled="pending" @click="refresh()">
          <IconRefresh class="size-4" :class="{ 'animate-spin': pending }" />
        </Button>
      </div>
    </CardHeader>
    <CardContent>
      <div v-if="pending && !metrics" class="space-y-4">
        <Skeleton v-for="i in 3" :key="i" class="h-12 w-full" />
      </div>
      <div v-else-if="!metrics" class="text-sm text-muted-foreground">
        No metrics available. Either no pod is running yet, or
        <code>metrics-server</code> is not installed in the cluster.
      </div>
      <div v-else class="space-y-5">
        <div>
          <div class="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span class="font-medium">CPU</span>
            <span class="font-mono text-xs text-muted-foreground">
              {{ formatCpuMilli(metrics.pod.cpuMilli) }} /
              {{ metrics.pod.cpuLimitMilli ? formatCpuMilli(metrics.pod.cpuLimitMilli) : '—' }}
              <span class="ml-1">({{ usagePct(metrics.pod.cpuMilli, metrics.pod.cpuLimitMilli) }}%)</span>
            </span>
          </div>
          <div class="h-2 w-full overflow-hidden rounded bg-muted">
            <div
              class="h-full transition-all"
              :class="usagePctClass(usagePct(metrics.pod.cpuMilli, metrics.pod.cpuLimitMilli))"
              :style="{ width: usagePct(metrics.pod.cpuMilli, metrics.pod.cpuLimitMilli) + '%' }"
            />
          </div>
        </div>

        <div>
          <div class="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span class="font-medium">Memory</span>
            <span class="font-mono text-xs text-muted-foreground">
              {{ formatBytes(metrics.pod.memBytes) }} /
              {{ metrics.pod.memLimitBytes ? formatBytes(metrics.pod.memLimitBytes) : '—' }}
              <span class="ml-1">({{ usagePct(metrics.pod.memBytes, metrics.pod.memLimitBytes) }}%)</span>
            </span>
          </div>
          <div class="h-2 w-full overflow-hidden rounded bg-muted">
            <div
              class="h-full transition-all"
              :class="usagePctClass(usagePct(metrics.pod.memBytes, metrics.pod.memLimitBytes))"
              :style="{ width: usagePct(metrics.pod.memBytes, metrics.pod.memLimitBytes) + '%' }"
            />
          </div>
        </div>

        <div>
          <div class="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span class="font-medium">
              Node disk
              <span class="ml-1 font-mono text-xs text-muted-foreground">
                {{ metrics.node.name }}
              </span>
            </span>
            <span class="font-mono text-xs text-muted-foreground">
              {{ formatBytes(diskUsed) }} / {{ formatBytes(metrics.node.diskCapacityBytes) }}
              <span class="ml-1">
                ({{ usagePct(diskUsed, metrics.node.diskCapacityBytes) }}%)
              </span>
            </span>
          </div>
          <div class="h-2 w-full overflow-hidden rounded bg-muted">
            <div
              class="h-full transition-all"
              :class="usagePctClass(usagePct(diskUsed, metrics.node.diskCapacityBytes))"
              :style="{ width: usagePct(diskUsed, metrics.node.diskCapacityBytes) + '%' }"
            />
          </div>
          <p class="mt-1 text-xs text-muted-foreground">
            {{ formatBytes(metrics.node.diskAvailBytes) }} free
          </p>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
