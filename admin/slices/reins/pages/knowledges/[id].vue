<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core';
import { Button } from '#theme/components/ui/button';
import type { IKnowledge } from '#reins/stores/knowledge';

const route = useRoute();
const store = useKnowledgeStore();
const confirmStore = useConfirmStore();

const knowledgeId = computed(() => route.params.id as string);
const current = ref<IKnowledge | null>(null);
const indexing = ref(false);
const indexError = ref<string | null>(null);

async function refresh() {
  current.value = await store.fetchById(knowledgeId.value);
}

await refresh();

const POLL_RUNNING_MS = 3000;
// Reconciliation is a background drip, not a live run: a large document sits in
// LightRAG's pipeline for the better part of an hour, and watching that at the
// run cadence would be thousands of requests to catch a badge that changes once.
const POLL_PROCESSING_MS = 15000;

// 'running' is a run executing right now; 'processing' is LightRAG still
// chunking documents a finished run stopped waiting for. Both mean the page is
// out of date soon, at very different speeds.
const outstanding = computed<'running' | 'processing' | 'none'>(() => {
  const k = current.value;
  if (!k) return 'none';
  if (k.indexStatus === 'indexing') return 'running';
  return k.processingCount > 0 ? 'processing' : 'none';
});

const { pause, resume } = useIntervalFn(
  refresh,
  computed(() =>
    outstanding.value === 'running' ? POLL_RUNNING_MS : POLL_PROCESSING_MS,
  ),
  { immediate: false },
);

watch(
  outstanding,
  (state) => {
    if (state === 'none') pause();
    else resume();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  pause();
});

// Sources that an index run will actually push through LightRAG. Ones already
// indexed are only re-checked, so they cost nothing.
const toIndex = computed(() => {
  if (!current.value) return 0;
  return current.value.sourceCount - current.value.indexedCount;
});

const progressPercent = computed(() => {
  if (!current.value || current.value.sourceCount === 0) return 0;
  return Math.round(
    (current.value.indexedCount / current.value.sourceCount) * 100,
  );
});

async function handleIndex() {
  if (!current.value) return;

  // Re-indexing is what costs money (LLM over every unindexed document), and
  // people were pressing it "to be sure". Say exactly what will happen first.
  //
  // The count is a floor, not a promise: it is derived from what Ranch has
  // recorded, while the run asks LightRAG about every source and re-sends
  // whatever it no longer holds. After the LightRAG index is cleared this
  // dialog said "42 of 210" and then sent all 210, so the wording has to admit
  // that rather than quote a number it cannot guarantee.
  const total = current.value.sourceCount;
  // Sources LightRAG is still chunking are waited on, not re-sent, so they do
  // not belong in the "never confirmed" bucket that reads as work to redo.
  const processing = current.value.processingCount;
  const neverConfirmed = toIndex.value - current.value.failedCount - processing;
  const breakdown = [
    `${current.value.failedCount} failed earlier`,
    ...(processing > 0 ? [`${processing} still processing`] : []),
    `${neverConfirmed} never confirmed`,
  ].join(', ');
  const knownWork =
    toIndex.value === 0
      ? `All ${total} source${total === 1 ? ' is' : 's are'} marked indexed, so this run may only re-verify them.`
      : `At least ${toIndex.value} of ${total} source${total === 1 ? '' : 's'} will go through the LLM (${breakdown}).`;
  const description = `${knownWork} Every source is re-checked against LightRAG, and any it no longer holds is sent again - if the LightRAG index was cleared, that means all ${total}. This costs money and can take a while on a large base.`;

  const ok = await confirmStore.ask({
    title: `Index ${current.value.name}?`,
    description,
    confirmLabel: 'Start indexing',
    cancelLabel: 'Cancel',
  });
  if (!ok) return;

  indexing.value = true;
  indexError.value = null;
  try {
    await store.startIndex(current.value.id);
    await refresh();
    resume();
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } }; message?: string };
    indexError.value = e?.response?.data?.message ?? e?.message ?? 'Index failed';
  } finally {
    indexing.value = false;
  }
}

const tabs = computed(() => [
  { to: `/knowledges/${knowledgeId.value}`, label: 'Overview' },
  { to: `/knowledges/${knowledgeId.value}/sources`, label: 'Sources' },
  { to: `/knowledges/${knowledgeId.value}/graph`, label: 'Graph' },
  { to: `/knowledges/${knowledgeId.value}/query`, label: 'Query' },
]);

// Deliberately not NuxtLink's `active-class`. That prop appends classes rather
// than replacing them, so `border-primary` and the base `border-transparent`
// end up at equal specificity and the winner is decided by their order in the
// generated stylesheet, not by the markup - which is why the selected tab was
// never highlighted. Binding the whole class set on an explicit match removes
// the conflict. Exact comparison, because Overview's path is a prefix of every
// sibling's and a prefix match would light all four at once.
function isActive(to: string): boolean {
  return route.path.replace(/\/+$/, '') === to;
}

// The index error is a concatenation of one message per failed source, so on a
// large base it is a paragraph, not a line. Show the shape of it and let the
// full text be asked for.
const ERROR_PREVIEW_CHARS = 160;
const errorExpanded = ref(false);
const errorIsLong = computed(
  () => (current.value?.indexError?.length ?? 0) > ERROR_PREVIEW_CHARS,
);

const indexDisabled = computed(
  () => current.value?.indexStatus === 'indexing' || indexing.value,
);

// Whether the base can answer, and the isolation-era retrieval health —
// visible without leaving the header (FR-023). Derived from the row's
// counts: the source list endpoint pages at 200 and these numbers must not.
const canAnswer = computed(() => {
  const k = current.value;
  if (!k) return false;
  return (
    k.indexedCount > 0 &&
    (k.instanceState === 'ready' || k.migrationState !== 'done')
  );
});
const queuedCount = computed(() => {
  const k = current.value;
  if (!k) return 0;
  // Never sent and not failed: what the Index button will actually process.
  return Math.max(
    k.sourceCount - k.indexedCount - k.processingCount - k.failedCount,
    0,
  );
});

provide('knowledge-current', current);
provide('knowledge-refresh', refresh);
</script>

<template>
  <div class="flex min-w-0 flex-col gap-6">
    <NuxtLink
      to="/knowledges"
      class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      ← Back to Knowledges
    </NuxtLink>

    <div v-if="current" class="flex items-start justify-between gap-4">
      <div class="min-w-0 flex-1">
        <h1 class="text-2xl font-semibold truncate">{{ current.name }}</h1>
        <div class="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <KnowledgeIndexStatusBadge
            :status="current.indexStatus"
            :processing="current.processingCount > 0"
          />
          <span>
            Indexed
            <span class="font-medium text-foreground">{{ current.indexedCount }}</span>
            / {{ current.sourceCount }}
          </span>
          <span
            v-if="current.processingCount"
            title="Handed to LightRAG and still being chunked. They are confirmed automatically as it finishes."
          >
            · {{ current.processingCount }} processing
          </span>
          <span v-if="current.failedCount" class="text-destructive">
            · {{ current.failedCount }} failed
          </span>
          <span v-if="canAnswer" class="text-emerald-600">
            · ready to answer
          </span>
          <span
            v-else-if="current.instanceState === 'failed'"
            class="text-destructive"
          >
            · retrieval unavailable{{ current.instanceError ? `: ${current.instanceError}` : '' }}
          </span>
          <span v-else-if="current.instanceState === 'starting'">
            · retrieval starting…
          </span>
        </div>

        <div v-if="current.indexError" class="mt-2 max-w-3xl text-sm text-destructive">
          <p
            class="break-words"
            :class="{ 'line-clamp-2': errorIsLong && !errorExpanded }"
          >
            {{ current.indexError }}
          </p>
          <button
            v-if="errorIsLong"
            type="button"
            class="mt-1 text-xs underline underline-offset-2"
            @click="errorExpanded = !errorExpanded"
          >
            {{ errorExpanded ? 'Show less' : 'Show full error' }}
          </button>
        </div>
        <div
          v-if="current.indexStatus === 'indexing'"
          class="mt-2 h-1.5 w-full max-w-md overflow-hidden rounded bg-muted"
          :title="`${progressPercent}%`"
        >
          <div
            class="h-full bg-primary transition-all"
            :style="{ width: `${progressPercent}%` }"
          />
        </div>
        <!-- Only while a migration run is actually executing: with instance
             isolation switched off, notStarted is the permanent, healthy
             state of every base and not worth a warning. -->
        <p
          v-if="current.migrationState === 'inProgress'"
          class="mt-1 text-xs text-amber-600"
        >
          This base is being re-processed into its own retrieval area —
          answers may be incomplete until it finishes.
        </p>
      </div>
      <Button :disabled="indexDisabled" @click="handleIndex">
        {{ indexDisabled ? 'Indexing…' : 'Index' }}
      </Button>
    </div>

    <p v-if="indexError" class="text-xs text-destructive">{{ indexError }}</p>

    <!-- The decisive moment to explain Index: content exists but is not
         searchable yet. -->
    <div
      v-if="queuedCount > 0 && current?.indexStatus !== 'indexing'"
      class="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700"
    >
      {{ queuedCount }} {{ queuedCount === 1 ? 'source is' : 'sources are' }}
      not searchable yet — press <span class="font-medium">Index</span> to
      process {{ queuedCount === 1 ? 'it' : 'them' }}. Agents only see what
      has been indexed.
    </div>

    <nav class="flex gap-1 border-b">
      <NuxtLink
        v-for="tab in tabs"
        :key="tab.to"
        :to="tab.to"
        class="border-b-2 px-3 py-2 text-sm transition-colors"
        :class="
          isActive(tab.to)
            ? 'border-primary font-medium text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        "
      >
        {{ tab.label }}
      </NuxtLink>
    </nav>

    <NuxtPage />
  </div>
</template>
