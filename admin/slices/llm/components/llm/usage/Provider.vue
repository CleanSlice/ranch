<script setup lang="ts">
const { rows, totals, loading, load } = useLlmUsageOverview();

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function formatCost(n: number): string {
  if (n === 0) return '$0.00';
  if (n < 0.01) return `< $0.01`;
  return `$${n.toFixed(2)}`;
}
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

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <LlmUsageStatCard
        title="30-day calls"
        :value="formatNumber(totals.callCount)"
        :sub="`Today: ${formatNumber(totals.todayCallCount)}`"
      />
      <LlmUsageStatCard title="Input tokens" :value="formatNumber(totals.inputTokens)" />
      <LlmUsageStatCard title="Output tokens" :value="formatNumber(totals.outputTokens)" />
      <LlmUsageStatCard
        title="30-day cost"
        :value="formatCost(totals.costUsd)"
        :sub="`Today: ${formatCost(totals.todayCostUsd)}`"
      />
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
            <TableCell colspan="6" class="py-6 text-center text-muted-foreground">
              Loading…
            </TableCell>
          </TableRow>
          <TableRow v-else-if="!loading && rows.length === 0">
            <TableCell colspan="6" class="py-6 text-center text-muted-foreground">
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
              {{ formatCost(row.costUsd) }}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  </div>
</template>
