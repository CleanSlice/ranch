<script setup lang="ts">
import type { ILlmCredentialData } from '#llm/stores/llm';
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

const llmStore = useLlmStore();

const { data: items, pending, refresh } = await useAsyncData(
  'admin-llms',
  () => llmStore.fetchAll(),
);

function mask(key: string) {
  if (!key) return '';
  if (key.length <= 8) return '•'.repeat(key.length);
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

const pendingRemoval = ref<ILlmCredentialData | null>(null);
const confirmRemoveOpen = computed({
  get: () => pendingRemoval.value !== null,
  set: (v: boolean) => {
    if (!v) pendingRemoval.value = null;
  },
});

async function onRemove() {
  const item = pendingRemoval.value;
  if (!item) return;
  pendingRemoval.value = null;
  await llmStore.remove(item.id);
  await refresh();
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between">
      <p class="text-sm text-muted-foreground">
        Provider/model/apiKey become <code>LLM_PROVIDER</code> /
        <code>LLM_MODEL</code> / <code>LLM_FALLBACK_MODEL</code> /
        <code>LLM_API_KEY</code> on the agent pod at submit time.
      </p>
      <Button as-child>
        <NuxtLink to="/llms/create">New credential</NuxtLink>
      </Button>
    </div>

    <div v-if="pending" class="text-sm text-muted-foreground">Loading…</div>

    <div v-else-if="items?.length" class="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Provider</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>Label</TableHead>
            <TableHead>API key</TableHead>
            <TableHead>Status</TableHead>
            <TableHead class="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="item in items"
            :key="item.id"
            class="cursor-pointer"
            @click="navigateTo(`/llms/${item.id}/edit`)"
          >
            <TableCell class="font-medium">{{ item.provider }}</TableCell>
            <TableCell>
              <code class="text-xs">{{ item.model }}</code>
            </TableCell>
            <TableCell class="text-muted-foreground">{{ item.label ?? '—' }}</TableCell>
            <TableCell>
              <code class="text-xs text-muted-foreground">{{ mask(item.apiKey) }}</code>
            </TableCell>
            <TableCell>
              <Badge :variant="item.status === 'active' ? 'default' : 'outline'">
                {{ item.status }}
              </Badge>
            </TableCell>
            <TableCell @click.stop>
              <div class="flex justify-end gap-2">
                <Button size="sm" variant="outline" as-child>
                  <NuxtLink :to="`/llms/${item.id}/edit`">Edit</NuxtLink>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  class="text-destructive"
                  @click="pendingRemoval = item"
                >
                  Delete
                </Button>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <div
      v-else
      class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground"
    >
      No LLM credentials yet.
    </div>

    <ConfirmDialog
      v-model:open="confirmRemoveOpen"
      title="Delete credential"
      :description="pendingRemoval ? `Permanently delete the ${pendingRemoval.provider} credential${pendingRemoval.label ? ` “${pendingRemoval.label}”` : ''}? Agents using it will lose access on next restart.` : ''"
      confirm-label="Delete credential"
      @confirm="onRemove"
    />
  </div>
</template>
