<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core';
import { Button } from '#theme/components/ui/button';
import type { IKnowledge, ISource } from '#reins/stores/knowledge';

const route = useRoute();
const store = useKnowledgeStore();

const knowledgeId = computed(() => route.params.id as string);
const current = ref<IKnowledge | null>(null);
const sources = ref<ISource[]>([]);
const indexing = ref(false);
const indexError = ref<string | null>(null);

async function refresh() {
  [current.value, sources.value] = await Promise.all([
    store.fetchById(knowledgeId.value),
    store.listSources(knowledgeId.value).catch(() => []),
  ]);
}

await refresh();

// What the base holds and whether it can answer — visible without leaving
// the header (FR-023).
const searchableCount = computed(
  () => sources.value.filter((s) => s.indexState === 'indexed').length,
);
const canAnswer = computed(
  () =>
    searchableCount.value > 0 &&
    (current.value?.instanceState === 'ready' ||
      current.value?.migrationState !== 'done'),
);

const { pause, resume } = useIntervalFn(
  async () => {
    await refresh();
    if (current.value?.indexStatus !== 'indexing') {
      pause();
    }
  },
  3000,
  { immediate: false },
);

watch(
  () => current.value?.indexStatus,
  (status) => {
    if (status === 'indexing') resume();
    else pause();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  pause();
});

async function handleIndex() {
  if (!current.value) return;
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

// Everyday path first (add content, ask); the graph is an inspection
// surface and sits last rather than mid-flow (FR-024).
const tabs = computed(() => [
  { to: `/knowledges/${knowledgeId.value}/sources`, label: 'Sources' },
  { to: `/knowledges/${knowledgeId.value}/query`, label: 'Query' },
  { to: `/knowledges/${knowledgeId.value}/edit`, label: 'General' },
  { to: `/knowledges/${knowledgeId.value}/graph`, label: 'Graph' },
]);

const indexDisabled = computed(
  () => current.value?.indexStatus === 'indexing' || indexing.value,
);

provide('knowledge-current', current);
provide('knowledge-refresh', refresh);
</script>

<template>
  <div class="flex flex-col gap-6">
    <NuxtLink
      to="/knowledges"
      class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      ← Back to Knowledges
    </NuxtLink>

    <div v-if="current" class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <h1 class="text-2xl font-semibold truncate">{{ current.name }}</h1>
        <div class="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <KnowledgeIndexStatusBadge :status="current.indexStatus" />
          <span>
            {{ sources.length }} {{ sources.length === 1 ? 'source' : 'sources' }}
            <template v-if="sources.length">
              · {{ searchableCount }} searchable
            </template>
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
          <span v-if="current.indexError" class="text-destructive">
            {{ current.indexError }}
          </span>
        </div>
        <p
          v-if="current.migrationState === 'inProgress' || current.migrationState === 'notStarted'"
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

    <!-- `custom` slot: exactly one class set is ever applied per state. The
         old active-class approach set the same properties from two classes
         at equal specificity, so stylesheet order decided the winner and
         nothing ever highlighted. -->
    <nav class="flex gap-1 border-b">
      <NuxtLink
        v-for="tab in tabs"
        :key="tab.to"
        v-slot="{ href, navigate, isActive }"
        :to="tab.to"
        custom
      >
        <a
          :href="href"
          class="border-b-2 px-3 py-2 text-sm transition-colors"
          :class="
            isActive
              ? 'border-primary font-medium text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          "
          :aria-current="isActive ? 'page' : undefined"
          @click="navigate"
        >
          {{ tab.label }}
        </a>
      </NuxtLink>
    </nav>

    <NuxtPage />
  </div>
</template>
