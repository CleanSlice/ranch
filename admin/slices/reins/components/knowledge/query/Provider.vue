<script setup lang="ts">
import type { IQueryResult } from '#reins/stores/knowledge';

type QueryMode = 'hybrid' | 'local' | 'global' | 'naive';

const route = useRoute();
const store = useKnowledgeStore();

const query = ref('');
const mode = ref<QueryMode>('hybrid');
const topK = ref(10);
const loading = ref(false);
const result = ref<IQueryResult | null>(null);
const errorMessage = ref<string | null>(null);
// Retrieval tuning stays folded until asked for — the default path needs
// only a question (FR-017/FR-018).
const showTuning = ref(false);

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
  <div class="flex flex-col gap-4">
    <p class="text-sm text-muted-foreground">
      A test bench: ask this base exactly what your agents will ask it through
      the <code class="text-xs">query_knowledge</code> tool, and check the
      answer and its sources before trusting the base to an agent.
    </p>

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
        <div
          v-if="!result.complete"
          class="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700"
        >
          This base is still being re-processed — answers may be incomplete
          until it finishes.
        </div>

        <div
          v-if="result.answer === null"
          class="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
        >
          This base has no content relevant to that question.
        </div>
        <div v-else class="rounded-md border bg-card p-4">
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
              {{ ref.sourceName ?? ref.filePath }}
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
      <Button :disabled="loading" @click="run">
        {{ loading ? 'Running…' : 'Run' }}
      </Button>

      <button
        type="button"
        class="self-start text-xs text-muted-foreground underline-offset-2 hover:underline"
        @click="showTuning = !showTuning"
      >
        {{ showTuning ? 'Hide' : 'Show' }} retrieval tuning
      </button>

      <div v-if="showTuning" class="grid gap-3 rounded-md border p-3">
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
          <p class="text-xs text-muted-foreground">
            How the answer is assembled. Hybrid combines specific facts with
            base-wide themes and is the default; Local favours precise detail
            but misses the big picture, Global the reverse; Naive skips the
            graph entirely — fastest, least accurate.
          </p>
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
          <p class="text-xs text-muted-foreground">
            How many matches feed the answer. More gives broader coverage but
            a slower, costlier query that can drown the relevant part.
          </p>
        </div>
        </div>
      </div>
    </div>
  </div>
</template>
