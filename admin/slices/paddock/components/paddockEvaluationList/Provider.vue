<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import { Badge } from '#theme/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#theme/components/ui/table';

const props = defineProps<{
  agentId?: string;
  templateId?: string;
  limit?: number;
  /**
   * Hide the Agent column when the list is already scoped to a single agent
   * (e.g. on the agent detail page).
   */
  hideAgent?: boolean;
}>();

const store = usePaddockEvaluationStore();
const agentStore = useAgentStore();
const templateStore = useTemplateStore();

const cacheKey = `paddock-evaluations-${props.agentId ?? 'all'}-${props.templateId ?? 'all'}`;

const { data: evaluations, pending, refresh } = await useAsyncData(
  cacheKey,
  () =>
    store.fetchAll({
      agentId: props.agentId,
      templateId: props.templateId,
      limit: props.limit ?? 50,
    }),
);

// Prefetch agents + templates only when not already scoped — used to render
// names in the Agent / Template columns.
const showAgent = computed(() => !props.hideAgent && !props.agentId);
const showTemplate = computed(() => !props.templateId && !props.agentId);

await useAsyncData('paddock-list-agents', () => agentStore.fetchAll(), {
  immediate: showAgent.value || showTemplate.value,
});
await useAsyncData('paddock-list-templates', () => templateStore.fetchAll(), {
  immediate: showTemplate.value,
});

const agentName = (id: string): string => {
  const a = agentStore.agents.find((x) => x.id === id);
  return a?.name ?? id;
};

const templateName = (id: string | null): string => {
  if (!id) return '—';
  const t = templateStore.templates.find((x) => x.id === id);
  return t?.name ?? id;
};

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—';

const formatPassRate = (rate: number | null) =>
  rate === null ? '—' : `${Math.round(rate * 100)}%`;

const statusVariant = (status: string) => {
  if (status === 'done') return 'default';
  if (status === 'running') return 'secondary';
  if (status === 'aborted') return 'outline';
  return 'destructive';
};

defineExpose({ refresh, pending });
</script>

<template>
  <div class="flex flex-col gap-4">
    <div v-if="pending" class="text-sm text-muted-foreground">Loading…</div>

    <div v-else-if="evaluations?.length" class="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Status</TableHead>
            <TableHead v-if="showAgent">Agent</TableHead>
            <TableHead v-if="showTemplate">Template</TableHead>
            <TableHead>Pass rate</TableHead>
            <TableHead>Scenarios</TableHead>
            <TableHead>Started</TableHead>
            <TableHead>Finished</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="ev in evaluations"
            :key="ev.id"
            class="cursor-pointer"
            @click="navigateTo(`/paddock/${ev.id}`)"
          >
            <TableCell>
              <Badge :variant="statusVariant(ev.status)">{{ ev.status }}</Badge>
            </TableCell>
            <TableCell v-if="showAgent" @click.stop>
              <NuxtLink
                :to="`/agents/${ev.agentId}`"
                class="text-sm font-medium hover:underline"
              >
                {{ agentName(ev.agentId) }}
              </NuxtLink>
            </TableCell>
            <TableCell v-if="showTemplate" @click.stop class="text-muted-foreground">
              <NuxtLink
                v-if="ev.templateId"
                :to="`/templates/${ev.templateId}`"
                class="text-sm hover:underline"
              >
                {{ templateName(ev.templateId) }}
              </NuxtLink>
              <span v-else>—</span>
            </TableCell>
            <TableCell>
              <span class="font-medium">{{ formatPassRate(ev.passRate) }}</span>
              <span class="text-xs text-muted-foreground"> ({{ ev.passCount }}/{{ ev.scenarioCount }})</span>
            </TableCell>
            <TableCell class="text-muted-foreground">{{ ev.scenarioCount }}</TableCell>
            <TableCell class="text-muted-foreground">{{ formatDate(ev.startedAt) }}</TableCell>
            <TableCell class="text-muted-foreground">{{ formatDate(ev.finishedAt) }}</TableCell>
            <TableCell @click.stop>
              <Button size="sm" variant="ghost" as-child>
                <NuxtLink :to="`/paddock/${ev.id}`">Open</NuxtLink>
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <div v-else class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
      No evaluations yet.
    </div>
  </div>
</template>
