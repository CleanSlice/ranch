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

async function onRemove(item: ILlmCredentialData) {
  if (!confirm('Delete this credential?')) return;
  await llmStore.remove(item.id);
  await refresh();
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold">LLMs</h1>
        <p class="text-sm text-muted-foreground">
          Credentials injected into agent pods as env vars —
          first active row per provider (anthropic → <code>ANTHROPIC_API_KEY</code>,
          openai → <code>OPENAI_API_KEY</code>, …).
        </p>
      </div>
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
                  @click="onRemove(item)"
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
  </div>
</template>
