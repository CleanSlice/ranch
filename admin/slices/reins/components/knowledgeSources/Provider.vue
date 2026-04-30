<script setup lang="ts">
import type { IKnowledge, ISource } from '#reins/stores/knowledge';
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

const route = useRoute();
const store = useKnowledgeStore();
const current = inject<Ref<IKnowledge | null>>('knowledge-current');
const refresh = inject<() => Promise<void>>('knowledge-refresh');

const sources = ref<ISource[]>([]);
const loading = ref(false);

async function reload() {
  loading.value = true;
  try {
    sources.value = await store.listSources(route.params.id as string);
  } finally {
    loading.value = false;
  }
}

await reload();

async function handleDelete(source: ISource) {
  if (!confirm(`Delete source "${source.name}"?`)) return;
  await store.removeSource(route.params.id as string, source.id);
  await reload();
  if (refresh) await refresh();
}

async function onAdded() {
  await reload();
  if (refresh) await refresh();
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <KnowledgeSourcesAddForm
      :knowledge-id="(route.params.id as string)"
      @added="onAdded"
    />

    <div v-if="loading" class="text-sm text-muted-foreground">Loading…</div>

    <div v-else-if="sources.length" class="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Indexed</TableHead>
            <TableHead class="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="s in sources" :key="s.id">
            <TableCell class="font-medium">{{ s.name }}</TableCell>
            <TableCell class="text-muted-foreground">{{ s.type }}</TableCell>
            <TableCell>
              <Badge :variant="s.indexed ? 'default' : 'outline'">
                {{ s.indexed ? 'Indexed' : 'Pending' }}
              </Badge>
            </TableCell>
            <TableCell class="text-right">
              <Button
                size="sm"
                variant="ghost"
                class="text-destructive"
                @click="handleDelete(s)"
              >
                Delete
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <div
      v-else
      class="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
    >
      No sources yet. Add one above, then run Index.
    </div>
  </div>
</template>
