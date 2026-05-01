<script setup lang="ts">
import type { IKnowledge } from '#reins/stores/knowledge';
import { Button } from '#theme/components/ui/button';
import { Input } from '#theme/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#theme/components/ui/table';

const store = useKnowledgeStore();

const [{ data: items, pending, refresh }] = await Promise.all([
  useAsyncData('admin-reins-knowledges', () => store.fetchAll()),
  useAsyncData('admin-reins-status', () => store.fetchStatus()),
]);

const search = ref('');

const filtered = computed<IKnowledge[]>(() => {
  const list = items.value ?? [];
  const q = search.value.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (k) =>
      k.name.toLowerCase().includes(q) ||
      (k.description ?? '').toLowerCase().includes(q),
  );
});

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

async function onRemove(item: IKnowledge) {
  if (!confirm(`Delete knowledge "${item.name}"?`)) return;
  await store.remove(item.id);
  await refresh();
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold">Knowledges</h1>
        <p class="text-sm text-muted-foreground">
          Knowledge bases backed by LightRAG. Create one, add sources, then index.
        </p>
      </div>
      <Button as-child :disabled="!store.enabled">
        <NuxtLink
          v-if="store.enabled"
          to="/knowledges/create"
        >New knowledge</NuxtLink>
        <span v-else>New knowledge</span>
      </Button>
    </div>

    <div
      v-if="!store.enabled"
      class="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200"
    >
      Knowledge service is disabled. Set the URL in
      <NuxtLink to="/settings" class="underline">Settings → Knowledge service</NuxtLink>
      to enable knowledges.
    </div>

    <Input v-model="search" placeholder="Search" class="max-w-sm" />

    <div v-if="pending" class="text-sm text-muted-foreground">Loading…</div>

    <div v-else-if="filtered.length" class="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Sources</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead class="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="item in filtered"
            :key="item.id"
            class="cursor-pointer"
            @click="navigateTo(`/knowledges/${item.id}/edit`)"
          >
            <TableCell class="font-medium">{{ item.name }}</TableCell>
            <TableCell>{{ item.sources?.length ?? 0 }}</TableCell>
            <TableCell>
              <IndexStatusBadge :status="item.indexStatus" />
            </TableCell>
            <TableCell class="text-muted-foreground">
              {{ formatDate(item.updatedAt) }}
            </TableCell>
            <TableCell @click.stop>
              <div class="flex justify-end gap-2">
                <Button size="sm" variant="outline" as-child>
                  <NuxtLink :to="`/knowledges/${item.id}/edit`">Edit</NuxtLink>
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
      No knowledge bases yet.
    </div>
  </div>
</template>
