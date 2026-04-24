<script setup lang="ts">
import type { IQueryRecord } from '#reins/stores/knowledge';
import { Button } from '#theme/components/ui/button';
import { Input } from '#theme/components/ui/input';
import { Label } from '#theme/components/ui/label';
import { Textarea } from '#theme/components/ui/textarea';

type QueryMode = 'hybrid' | 'local' | 'global' | 'naive';

const route = useRoute();
const store = useKnowledgeStore();

const query = ref('');
const mode = ref<QueryMode>('hybrid');
const topK = ref(10);
const loading = ref(false);
const items = ref<IQueryRecord[]>([]);
const errorMessage = ref<string | null>(null);

async function run() {
  if (!query.value.trim()) return;
  loading.value = true;
  errorMessage.value = null;
  try {
    items.value = await store.query(
      route.params.id as string,
      query.value,
      mode.value,
      topK.value,
    );
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } }; message?: string };
    errorMessage.value = e?.response?.data?.message ?? e?.message ?? 'Query failed';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="grid gap-6 md:grid-cols-[1fr_280px]">
    <div class="flex flex-col gap-3">
      <div v-if="loading" class="text-sm text-muted-foreground">Searching…</div>
      <div v-else-if="errorMessage" class="text-sm text-destructive">
        {{ errorMessage }}
      </div>
      <div
        v-else-if="items.length === 0"
        class="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
      >
        Enter a query and press Run.
      </div>

      <div
        v-for="(item, idx) in items"
        :key="idx"
        class="rounded-md border bg-card p-4"
      >
        <div class="mb-1 text-sm font-medium">
          {{ item.metadata.title ?? item.metadata.sourceId ?? 'Unknown source' }}
        </div>
        <p class="whitespace-pre-wrap text-sm text-muted-foreground">
          {{ item.pageContent }}
        </p>
      </div>
    </div>

    <div class="flex flex-col gap-3">
      <div class="grid gap-2">
        <Label for="query-text">Query</Label>
        <Textarea
          id="query-text"
          v-model="query"
          rows="4"
          placeholder="Ask a question…"
        />
      </div>
      <div class="grid gap-2">
        <Label for="query-mode">Mode</Label>
        <select
          id="query-mode"
          v-model="mode"
          class="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="hybrid">Hybrid</option>
          <option value="local">Local</option>
          <option value="global">Global</option>
          <option value="naive">Naive</option>
        </select>
      </div>
      <div class="grid gap-2">
        <Label for="query-topk">Top K</Label>
        <Input
          id="query-topk"
          v-model.number="topK"
          type="number"
          min="1"
          max="100"
        />
      </div>
      <Button :disabled="loading" @click="run">
        {{ loading ? 'Running…' : 'Run' }}
      </Button>
    </div>
  </div>
</template>
