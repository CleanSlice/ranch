<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core';
import { Button } from '#theme/components/ui/button';
import type { IKnowledge } from '#reins/stores/knowledge';

const route = useRoute();
const store = useKnowledgeStore();

const knowledgeId = computed(() => route.params.id as string);
const current = ref<IKnowledge | null>(null);
const indexing = ref(false);
const indexError = ref<string | null>(null);

async function refresh() {
  current.value = await store.fetchById(knowledgeId.value);
}

await refresh();

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

const tabs = computed(() => [
  { to: `/knowledges/${knowledgeId.value}/edit`, label: 'General' },
  { to: `/knowledges/${knowledgeId.value}/sources`, label: 'Sources' },
  { to: `/knowledges/${knowledgeId.value}/graph`, label: 'Graph' },
  { to: `/knowledges/${knowledgeId.value}/query`, label: 'Query' },
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
      ← Back to Knowledge
    </NuxtLink>

    <div v-if="current" class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <h1 class="text-2xl font-semibold truncate">{{ current.name }}</h1>
        <div class="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
          <IndexStatusBadge :status="current.indexStatus" />
          <span v-if="current.indexError" class="text-destructive">
            {{ current.indexError }}
          </span>
        </div>
      </div>
      <Button :disabled="indexDisabled" @click="handleIndex">
        {{ indexDisabled ? 'Indexing…' : 'Index' }}
      </Button>
    </div>

    <p v-if="indexError" class="text-xs text-destructive">{{ indexError }}</p>

    <nav class="flex gap-1 border-b">
      <NuxtLink
        v-for="tab in tabs"
        :key="tab.to"
        :to="tab.to"
        active-class="border-primary text-foreground"
        class="border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        {{ tab.label }}
      </NuxtLink>
    </nav>

    <NuxtPage />
  </div>
</template>
