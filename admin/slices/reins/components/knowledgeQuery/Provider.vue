<script setup lang="ts">
import type { IQueryResult } from '#reins/stores/knowledge';
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
const result = ref<IQueryResult | null>(null);
const errorMessage = ref<string | null>(null);

async function run() {
  if (!query.value.trim()) return;
  loading.value = true;
  errorMessage.value = null;
  try {
    result.value = await store.query(
      route.params.id as string,
      query.value,
      mode.value,
      topK.value,
    );
  } catch (err: unknown) {
    if (err instanceof Error) {
      errorMessage.value = err.message;
    } else {
      errorMessage.value = 'Query failed';
    }
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="grid gap-6 md:grid-cols-[1fr_280px]">
    <div class="flex flex-col gap-3">
      <div v-if="loading" class="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        Asking the model…
      </div>
      <div v-else-if="errorMessage" class="rounded-md border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
        {{ errorMessage }}
      </div>
      <div
        v-else-if="!result"
        class="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
      >
        Enter a question and press Run.
      </div>

      <template v-else>
        <div class="rounded-md border bg-card p-4">
          <div class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Answer
          </div>
          <p class="whitespace-pre-wrap text-sm leading-relaxed">{{ result.answer }}</p>
        </div>

        <div v-if="result.references.length" class="rounded-md border bg-card p-4">
          <div class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            References ({{ result.references.length }})
          </div>
          <ol class="flex flex-col gap-1 pl-5 text-sm list-decimal">
            <li v-for="ref in result.references" :key="ref.referenceId">
              <span class="font-mono text-xs text-muted-foreground">[{{ ref.referenceId }}]</span>
              {{ ref.filePath }}
            </li>
          </ol>
        </div>
      </template>
    </div>

    <div class="flex flex-col gap-3">
      <div class="grid gap-2">
        <Label for="query-text">Question</Label>
        <Textarea
          id="query-text"
          v-model="query"
          rows="4"
          placeholder="Ask a question about your knowledge…"
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
