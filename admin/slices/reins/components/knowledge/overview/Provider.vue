<script setup lang="ts">
import type { IKnowledge, SourceType } from '#reins/stores/knowledge';
import { errorMessageOf, formatDateTime } from '#reins/domain';

const store = useKnowledgeStore();
const current = inject<Ref<IKnowledge | null>>('knowledge-current');
const refresh = inject<() => Promise<void>>('knowledge-refresh');

const knowledgeId = computed(() => current?.value?.id ?? '');

// ---- counters --------------------------------------------------------------

// `pending` is everything not yet accounted for. It is derived rather than
// returned so the four tiles always add up to the total, whatever the API
// reports.
const counts = computed(() => {
  const k = current?.value;
  if (!k) return { total: 0, indexed: 0, processing: 0, failed: 0, pending: 0 };
  const pending = Math.max(
    0,
    k.sourceCount - k.indexedCount - k.processingCount - k.failedCount,
  );
  return {
    total: k.sourceCount,
    indexed: k.indexedCount,
    processing: k.processingCount,
    failed: k.failedCount,
    pending,
  };
});

const progressPercent = computed(() => {
  const { total, indexed } = counts.value;
  return total === 0 ? 0 : Math.round((indexed / total) * 100);
});

// ---- breakdown by type -----------------------------------------------------

const TYPES: readonly SourceType[] = ['file', 'url', 'text'];
const TYPE_LABELS: Record<SourceType, string> = {
  file: 'Files',
  url: 'URLs',
  text: 'Text',
};

const typeCounts = ref<Record<SourceType, number> | null>(null);

// One head request per type: `total` comes back on a page of one row, so this
// is three tiny queries rather than pulling 355 records to count them here.
async function loadTypeCounts(): Promise<void> {
  const id = knowledgeId.value;
  if (!id) return;
  try {
    const pages = await Promise.all(
      TYPES.map((type) => store.listSources(id, { page: 1, perPage: 1, type })),
    );
    const next: Record<SourceType, number> = { file: 0, url: 0, text: 0 };
    TYPES.forEach((type, i) => {
      next[type] = pages[i].total;
    });
    typeCounts.value = next;
  } catch {
    // A breakdown is a nicety. Losing it must not blank the page.
    typeCounts.value = null;
  }
}

const presentTypes = computed<Array<[SourceType, number]>>(() => {
  const counted = typeCounts.value;
  if (!counted) return [];
  return TYPES.map((type): [SourceType, number] => [type, counted[type]]).filter(
    ([, n]) => n > 0,
  );
});

// ---- runtime ---------------------------------------------------------------

const runtime = computed(() => store.runtime);
const setup = computed(() => store.setup);

const setupChecks = computed(() => [
  { label: 'Service URL', ok: setup.value.hasUrl },
  { label: 'Chat model selected', ok: setup.value.hasCredentialsSelected },
  { label: 'S3 bucket', ok: setup.value.hasBucket },
  { label: 'Reachable', ok: setup.value.isHealthy },
]);

onMounted(() => {
  // `statusChecked` survives navigation inside the console, so this is a first
  // visit only cost.
  if (!store.statusChecked) void store.fetchStatus();
  void loadTypeCounts();
});

watch(knowledgeId, () => {
  void loadTypeCounts();
});

// ---- details form ----------------------------------------------------------

const name = ref('');
const description = ref('');
const submitting = ref(false);
const errorMessage = ref<string | null>(null);
const savedAt = ref<number | null>(null);

// Keyed on the id, not on the object. The parent re-fetches this knowledge
// every few seconds while a run is in flight and hands back a fresh object each
// time; syncing on that would retype the fields under the user mid-sentence.
watch(
  knowledgeId,
  () => {
    const k = current?.value;
    if (!k) return;
    name.value = k.name;
    description.value = k.description ?? '';
  },
  { immediate: true },
);

const nameError = computed<string | null>(() => {
  const trimmed = name.value.trim();
  if (!trimmed) return 'Name is required';
  if (trimmed.length < 2) return 'Name must be at least 2 characters';
  return null;
});

const dirty = computed(() => {
  const k = current?.value;
  if (!k) return false;
  return (
    name.value.trim() !== k.name ||
    description.value.trim() !== (k.description ?? '')
  );
});

async function save(): Promise<void> {
  const k = current?.value;
  if (!k || nameError.value) return;
  submitting.value = true;
  errorMessage.value = null;
  try {
    await store.update(k.id, {
      name: name.value.trim(),
      description: description.value.trim() || null,
    });
    if (refresh) await refresh();
    savedAt.value = Date.now();
  } catch (err: unknown) {
    errorMessage.value = errorMessageOf(err, 'Could not save');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div v-if="current" class="flex min-w-0 flex-col gap-6">
    <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div class="rounded-md border bg-card p-4">
        <p class="text-xs text-muted-foreground">Sources</p>
        <p class="mt-1 text-2xl font-semibold">{{ counts.total }}</p>
      </div>
      <div class="rounded-md border bg-card p-4">
        <p class="text-xs text-muted-foreground">Indexed</p>
        <p class="mt-1 text-2xl font-semibold">{{ counts.indexed }}</p>
        <p class="text-xs text-muted-foreground">{{ progressPercent }}% of total</p>
      </div>
      <div class="rounded-md border bg-card p-4">
        <p class="text-xs text-muted-foreground">Processing</p>
        <p class="mt-1 text-2xl font-semibold">{{ counts.processing }}</p>
        <p class="text-xs text-muted-foreground">
          Handed over, confirmed automatically
        </p>
      </div>
      <div
        class="rounded-md border bg-card p-4"
        :class="counts.failed ? 'border-destructive/40' : ''"
      >
        <p class="text-xs text-muted-foreground">Failed</p>
        <p
          class="mt-1 text-2xl font-semibold"
          :class="counts.failed ? 'text-destructive' : ''"
        >
          {{ counts.failed }}
        </p>
        <p v-if="counts.pending" class="text-xs text-muted-foreground">
          {{ counts.pending }} never sent
        </p>
      </div>
    </section>

    <div class="grid min-w-0 gap-6 lg:grid-cols-2">
      <section class="flex min-w-0 flex-col gap-6">
        <div class="rounded-md border bg-card p-4">
          <h2 class="text-sm font-semibold">Details</h2>
          <div class="mt-4 grid gap-4">
            <div class="grid gap-2">
              <Label for="knowledge-name">Name</Label>
              <Input
                id="knowledge-name"
                v-model="name"
                :aria-invalid="!!nameError"
              />
              <p v-if="nameError" class="text-xs text-destructive">
                {{ nameError }}
              </p>
            </div>
            <div class="grid gap-2">
              <Label for="knowledge-description">Description</Label>
              <Textarea
                id="knowledge-description"
                v-model="description"
                rows="3"
                placeholder="Optional"
              />
            </div>
            <p v-if="errorMessage" class="text-xs text-destructive">
              {{ errorMessage }}
            </p>
            <div class="flex items-center gap-3">
              <Button
                :disabled="submitting || !dirty || !!nameError"
                @click="save"
              >
                {{ submitting ? 'Saving…' : 'Save' }}
              </Button>
              <span v-if="savedAt && !dirty" class="text-xs text-muted-foreground">
                Saved
              </span>
            </div>
          </div>
        </div>

        <div class="rounded-md border bg-card p-4">
          <h2 class="text-sm font-semibold">Content</h2>
          <dl class="mt-3 grid gap-2 text-sm">
            <div
              v-for="[type, n] in presentTypes"
              :key="type"
              class="flex justify-between gap-4"
            >
              <dt class="text-muted-foreground">{{ TYPE_LABELS[type] }}</dt>
              <dd class="font-medium">{{ n }}</dd>
            </div>
            <p
              v-if="!presentTypes.length"
              class="text-sm text-muted-foreground"
            >
              No sources yet.
            </p>
            <div class="flex justify-between gap-4 border-t pt-2">
              <dt class="text-muted-foreground">Last indexed</dt>
              <dd class="font-medium">{{ formatDateTime(current.indexedAt) }}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-muted-foreground">Last run started</dt>
              <dd class="font-medium">
                {{ formatDateTime(current.indexStartedAt) }}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section class="flex min-w-0 flex-col gap-6">
        <div class="rounded-md border bg-card p-4">
          <h2 class="text-sm font-semibold">Runtime</h2>
          <p class="mt-1 text-xs text-muted-foreground">
            What the indexing service is actually running. Read from the service
            itself, so it reflects how it was started rather than what is picked
            in Settings.
          </p>
          <dl v-if="runtime" class="mt-3 grid gap-2 text-sm">
            <div class="flex justify-between gap-4">
              <dt class="text-muted-foreground">LLM</dt>
              <dd class="min-w-0 truncate font-medium" :title="runtime.llmModel ?? ''">
                {{ runtime.llmBinding ?? '-' }} · {{ runtime.llmModel ?? '-' }}
              </dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-muted-foreground">Embedding</dt>
              <dd
                class="min-w-0 truncate font-medium"
                :title="runtime.embeddingModel ?? ''"
              >
                {{ runtime.embeddingBinding ?? '-' }} ·
                {{ runtime.embeddingModel ?? '-' }}
              </dd>
            </div>
            <div v-if="runtime.embeddingBindingHost" class="flex justify-between gap-4">
              <dt class="text-muted-foreground">Embedding host</dt>
              <dd
                class="min-w-0 truncate font-medium"
                :title="runtime.embeddingBindingHost"
              >
                {{ runtime.embeddingBindingHost }}
              </dd>
            </div>
          </dl>
          <p v-else class="mt-3 text-sm text-muted-foreground">
            Not reported. The service is unreachable or not configured.
          </p>
        </div>

        <div class="rounded-md border bg-card p-4">
          <h2 class="text-sm font-semibold">Service</h2>
          <p class="mt-1 text-xs text-muted-foreground">
            Everything indexing needs. A missing bucket fails uploads silently,
            so it is worth a look before blaming a document.
          </p>
          <ul class="mt-3 grid gap-2 text-sm">
            <li
              v-for="check in setupChecks"
              :key="check.label"
              class="flex items-center justify-between gap-4"
            >
              <span class="text-muted-foreground">{{ check.label }}</span>
              <span
                class="font-medium"
                :class="check.ok ? 'text-emerald-600' : 'text-destructive'"
              >
                {{ check.ok ? 'OK' : 'Missing' }}
              </span>
            </li>
          </ul>
          <NuxtLink
            to="/settings/knowledge"
            class="mt-3 inline-block text-xs underline underline-offset-2"
          >
            Open knowledge settings
          </NuxtLink>
        </div>
      </section>
    </div>
  </div>
</template>
