<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#theme/components/ui/table';

interface IPerAgentUsage {
  agentId: string;
  agentName: string;
  callCount: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  topModel: string | null;
  todayCallCount: number;
  todayCostUsd: number;
}

const agentStore = useAgentStore();
const usageStore = useUsageStore();

const loading = ref(false);
const rows = ref<IPerAgentUsage[]>([]);

const totals = computed(() =>
  rows.value.reduce(
    (acc, r) => ({
      callCount: acc.callCount + r.callCount,
      inputTokens: acc.inputTokens + r.inputTokens,
      outputTokens: acc.outputTokens + r.outputTokens,
      costUsd: acc.costUsd + r.costUsd,
      todayCallCount: acc.todayCallCount + r.todayCallCount,
      todayCostUsd: acc.todayCostUsd + r.todayCostUsd,
    }),
    {
      callCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      todayCallCount: 0,
      todayCostUsd: 0,
    },
  ),
);

async function load() {
  loading.value = true;
  try {
    const agents = await agentStore.fetchAll();

    const settled = await Promise.allSettled(
      agents.map(async (agent) => {
        const usage = await usageStore.fetchForAgent(agent.id);
        if (!usage) return null;
        const todayKey = new Date().toISOString().slice(0, 10);
        const todayCostUsd = usage.last30days
          .filter((e) => e.date === todayKey)
          .reduce((a, b) => a + b.costUsd, 0);
        return {
          agentId: agent.id,
          agentName: agent.name,
          callCount: usage.totals.callCount,
          inputTokens: usage.totals.inputTokens,
          outputTokens: usage.totals.outputTokens,
          costUsd: usage.totals.costUsd,
          topModel: usage.topModel,
          todayCallCount: usage.today.callCount,
          todayCostUsd,
        } satisfies IPerAgentUsage;
      }),
    );

    rows.value = settled
      .filter(
        (r): r is PromiseFulfilledResult<IPerAgentUsage | null> =>
          r.status === 'fulfilled' && r.value !== null,
      )
      .map((r) => r.value as IPerAgentUsage)
      .sort((a, b) => b.costUsd - a.costUsd);
  } finally {
    loading.value = false;
  }
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function formatUsd(n: number): string {
  if (n === 0) return '$0.00';
  if (n < 0.01) return `< $0.01`;
  return `$${n.toFixed(2)}`;
}

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between">
      <p class="text-sm text-muted-foreground">
        Aggregated tokens and cost per agent across the last 30 days. Today's
        row is hot — pulled from each agent's live
        <code>data/usage.json</code> snapshot, the rest comes from reported
        daily aggregates.
      </p>
      <Button variant="outline" :disabled="loading" @click="load">
        Refresh
      </Button>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card>
        <CardHeader class="pb-2">
          <CardTitle class="text-sm font-medium text-muted-foreground">
            30-day calls
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-semibold">
            {{ formatNumber(totals.callCount) }}
          </div>
          <div class="text-xs text-muted-foreground">
            Today: {{ formatNumber(totals.todayCallCount) }}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="pb-2">
          <CardTitle class="text-sm font-medium text-muted-foreground">
            Input tokens
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-semibold">
            {{ formatNumber(totals.inputTokens) }}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="pb-2">
          <CardTitle class="text-sm font-medium text-muted-foreground">
            Output tokens
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-semibold">
            {{ formatNumber(totals.outputTokens) }}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="pb-2">
          <CardTitle class="text-sm font-medium text-muted-foreground">
            30-day cost
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-semibold">{{ formatUsd(totals.costUsd) }}</div>
          <div class="text-xs text-muted-foreground">
            Today: {{ formatUsd(totals.todayCostUsd) }}
          </div>
        </CardContent>
      </Card>
    </div>

    <div class="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Agent</TableHead>
            <TableHead>Top model</TableHead>
            <TableHead class="text-right">Calls</TableHead>
            <TableHead class="text-right">Input</TableHead>
            <TableHead class="text-right">Output</TableHead>
            <TableHead class="text-right">Cost (30d)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-if="loading && rows.length === 0">
            <TableCell colspan="6" class="text-center text-muted-foreground py-6">
              Loading…
            </TableCell>
          </TableRow>
          <TableRow v-else-if="!loading && rows.length === 0">
            <TableCell colspan="6" class="text-center text-muted-foreground py-6">
              No agents have reported usage yet.
            </TableCell>
          </TableRow>
          <TableRow
            v-for="row in rows"
            :key="row.agentId"
            class="cursor-pointer"
            @click="navigateTo(`/agents/${row.agentId}`)"
          >
            <TableCell class="font-medium">{{ row.agentName }}</TableCell>
            <TableCell class="text-muted-foreground">
              {{ row.topModel ?? '—' }}
            </TableCell>
            <TableCell class="text-right font-mono">
              {{ formatNumber(row.callCount) }}
            </TableCell>
            <TableCell class="text-right font-mono">
              {{ formatNumber(row.inputTokens) }}
            </TableCell>
            <TableCell class="text-right font-mono">
              {{ formatNumber(row.outputTokens) }}
            </TableCell>
            <TableCell class="text-right font-mono">
              {{ formatUsd(row.costUsd) }}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  </div>
</template>
