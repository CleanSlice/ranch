<script setup lang="ts">
import type { ITemplateData } from '#template/stores/template';
import {
  IconArrowsSort,
  IconLayoutGrid,
  IconListDetails,
  IconPackageImport,
  IconPlus,
  IconSearch,
} from '@tabler/icons-vue';
import { useLocalStorage } from '@vueuse/core';
import {
  SIZE_BUCKETS,
  selectTemplates,
  type SizeBucket,
  type TemplateSort,
} from '#template/utils/templateList';
import TemplateListCard from './Card.vue';
import TemplateListRow from './Row.vue';

/**
 * The templates list (CLEAN-130): search, a memory-size filter, Newest/Name
 * sort and a cards-or-table view that the browser remembers. Every row reads
 * the template store; agents are counted from the agent store so "3 agents
 * running" is the same number the agents rail shows.
 */
const templateStore = useTemplateStore();
const agentStore = useAgentStore();
const rancherStore = useRancherStore();

const { templates } = storeToRefs(templateStore);
const { agents } = storeToRefs(agentStore);
const { status: rancherStatus } = storeToRefs(rancherStore);

const { pending, refresh } = await useAsyncData('admin-templates', () =>
  templateStore.fetchAll(),
);
const { refresh: refreshRancher } = await useAsyncData(
  'admin-rancher-status',
  () => rancherStore.fetchStatus(),
);
// Lazy: the list is useful before the agent counts arrive.
useAsyncData('admin-templates-agents', () => agentStore.fetchAll(), { lazy: true });

const query = ref('');
const size = ref<SizeBucket>('all');
const sort = ref<TemplateSort>('recent');
const view = useLocalStorage<'cards' | 'table'>('admin.templates.view', 'cards');

const items = computed(() =>
  selectTemplates(templates.value, {
    query: query.value,
    size: size.value,
    sort: sort.value,
  }),
);

const runningByTemplate = computed(() => {
  const counts = new Map<string, number>();
  for (const a of agents.value) {
    if (a.status !== 'running') continue;
    counts.set(a.templateId, (counts.get(a.templateId) ?? 0) + 1);
  }
  return counts;
});
const running = (t: ITemplateData) => runningByTemplate.value.get(t.id) ?? 0;

const managedId = computed(() => rancherStatus.value?.template?.id ?? null);

/** The table's footer names the image once when every template shares it. */
const sharedImage = computed(() => {
  const images = new Set(templates.value.map((t) => t.image));
  return images.size === 1 ? templates.value[0]!.image : null;
});

const ensuringRancher = ref(false);
const ensureError = ref<string | null>(null);

async function onEnsureRancher() {
  ensuringRancher.value = true;
  ensureError.value = null;
  try {
    await rancherStore.ensureTemplate();
    await Promise.all([refresh(), refreshRancher()]);
  } catch (err: unknown) {
    ensureError.value = err instanceof Error ? err.message : 'Failed to create Rancher template.';
  } finally {
    ensuringRancher.value = false;
  }
}

const pendingRemoval = ref<ITemplateData | null>(null);
const confirmRemoveOpen = computed({
  get: () => pendingRemoval.value !== null,
  set: (v: boolean) => {
    if (!v) pendingRemoval.value = null;
  },
});
const removeError = ref<string | null>(null);

async function onRemove() {
  const template = pendingRemoval.value;
  if (!template) return;
  pendingRemoval.value = null;
  removeError.value = null;
  try {
    await templateStore.remove(template.id);
  } catch (err: unknown) {
    removeError.value = err instanceof Error ? err.message : 'Failed to delete template.';
  }
}

const pendingRestart = ref<ITemplateData | null>(null);
const confirmRestartOpen = computed({
  get: () => pendingRestart.value !== null,
  set: (v: boolean) => {
    if (!v) pendingRestart.value = null;
  },
});
const restartError = ref<string | null>(null);
const restartResult = ref<{ restarted: number; failed: number; total: number } | null>(null);

async function onRestartAgents() {
  const template = pendingRestart.value;
  if (!template) return;
  pendingRestart.value = null;
  restartError.value = null;
  restartResult.value = null;
  try {
    restartResult.value = await templateStore.restartAgents(template.id);
  } catch (err: unknown) {
    restartError.value = err instanceof Error ? err.message : 'Failed to restart agents.';
  }
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-wrap items-end gap-4">
      <div class="flex min-w-0 flex-col gap-1.5">
        <div class="flex items-baseline gap-2.5">
          <h1 class="text-[28px] font-semibold tracking-tight">Templates</h1>
          <span class="font-mono text-[13px] text-muted-foreground/70">{{ templates.length }}</span>
        </div>
        <p class="text-sm text-muted-foreground text-pretty">
          Agent blueprints — image, resources, skills and tools every new agent starts with.
        </p>
      </div>
      <div class="ml-auto flex gap-2">
        <Button variant="outline" as-child>
          <NuxtLink to="/templates/install" class="inline-flex items-center gap-1.5">
            <IconPackageImport class="size-4" />
            Install from file
          </NuxtLink>
        </Button>
        <Button as-child>
          <NuxtLink to="/templates/create" class="inline-flex items-center gap-1.5">
            <IconPlus class="size-4" />
            New template
          </NuxtLink>
        </Button>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2.5">
      <div class="relative min-w-60 max-w-md flex-1">
        <IconSearch class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input v-model="query" placeholder="Search templates" class="pl-9" />
      </div>
      <div class="flex gap-1 rounded-[9px] bg-muted p-[3px]" role="radiogroup" aria-label="Memory size">
        <button
          v-for="b in SIZE_BUCKETS"
          :key="b.key"
          type="button"
          role="radio"
          :aria-checked="size === b.key"
          class="h-[30px] rounded-md px-[11px] text-[12.5px] font-medium transition-colors"
          :class="
            size === b.key
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          "
          @click="size = b.key"
        >
          {{ b.label }}
        </button>
      </div>
      <div class="ml-auto flex items-center gap-2.5">
        <button
          type="button"
          class="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted"
          @click="sort = sort === 'name' ? 'recent' : 'name'"
        >
          Sort:
          <span class="font-medium text-foreground">{{ sort === 'name' ? 'Name' : 'Newest' }}</span>
          <IconArrowsSort class="size-3.5" />
        </button>
        <div class="flex gap-0.5 rounded-[9px] bg-muted p-[3px]" role="radiogroup" aria-label="View">
          <button
            type="button"
            role="radio"
            :aria-checked="view === 'cards'"
            title="Cards"
            class="grid h-7 w-[30px] place-items-center rounded-md transition-colors"
            :class="view === 'cards' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
            @click="view = 'cards'"
          >
            <IconLayoutGrid class="size-3.5" />
          </button>
          <button
            type="button"
            role="radio"
            :aria-checked="view === 'table'"
            title="Table"
            class="grid h-7 w-[30px] place-items-center rounded-md transition-colors"
            :class="view === 'table' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
            @click="view = 'table'"
          >
            <IconListDetails class="size-3.5" />
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="removeError"
      class="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      {{ removeError }}
    </div>

    <div
      v-if="restartError"
      class="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      {{ restartError }}
    </div>

    <div
      v-if="restartResult"
      class="rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-sm"
    >
      Restart triggered: {{ restartResult.restarted }} restarted, {{ restartResult.failed }} failed
      out of {{ restartResult.total }} agent(s).
    </div>

    <div
      v-if="rancherStatus && !rancherStatus.template"
      class="flex items-center justify-between gap-4 rounded-md border border-primary/30 bg-primary/5 px-4 py-3"
    >
      <div class="flex flex-col gap-1">
        <p class="text-sm font-medium">Rancher template is missing</p>
        <p class="text-xs text-muted-foreground">
          The Rancher template is required to spawn the Ranch admin agent. Create it with the recommended defaults.
        </p>
        <p v-if="ensureError" class="text-xs text-destructive">{{ ensureError }}</p>
      </div>
      <Button size="sm" :disabled="ensuringRancher" @click="onEnsureRancher">
        {{ ensuringRancher ? 'Creating…' : 'Create Rancher template' }}
      </Button>
    </div>

    <div v-if="pending && !templates.length" class="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
      <Skeleton v-for="i in 6" :key="i" class="h-[200px] rounded-[14px]" />
    </div>

    <template v-else>
      <div v-if="view === 'cards'" class="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        <NuxtLink
          to="/templates/create"
          class="flex min-h-[200px] flex-col items-start justify-center gap-2.5 rounded-[14px] border-[1.5px] border-dashed p-[22px] text-muted-foreground transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span class="grid size-[38px] place-items-center rounded-[10px] border border-current">
            <IconPlus class="size-4" />
          </span>
          <span class="text-[14.5px] font-semibold text-foreground">New template</span>
          <span class="text-[13px] leading-snug">
            Start blank, duplicate an existing one, or install a
            <code class="font-mono text-xs">.agent</code> bundle.
          </span>
        </NuxtLink>
        <TemplateListCard
          v-for="t in items"
          :key="t.id"
          :template="t"
          :running="running(t)"
          :managed="t.id === managedId"
          @restart="pendingRestart = t"
          @remove="pendingRemoval = t"
        />
      </div>

      <div v-else-if="items.length" class="overflow-hidden rounded-[14px] border bg-card">
        <div
          class="grid gap-4 border-b bg-muted/40 px-[18px] py-2.5 text-xs font-medium text-muted-foreground grid-cols-[minmax(0,1fr)_44px] md:grid-cols-[minmax(0,1fr)_170px_140px_150px_110px_44px]"
        >
          <span>Template</span>
          <span class="hidden md:block">Resources</span>
          <span class="hidden md:block">Capabilities</span>
          <span class="hidden md:block">Agents</span>
          <span class="hidden md:block">Created</span>
          <span />
        </div>
        <TemplateListRow
          v-for="t in items"
          :key="t.id"
          :template="t"
          :running="running(t)"
          :managed="t.id === managedId"
          @restart="pendingRestart = t"
          @remove="pendingRemoval = t"
        />
        <div v-if="sharedImage" class="px-[18px] py-2.5 text-xs text-muted-foreground/70">
          All templates use <code class="font-mono">{{ sharedImage }}</code>
        </div>
      </div>

      <div
        v-if="!items.length && templates.length"
        class="rounded-[14px] border border-dashed p-12 text-sm text-muted-foreground"
      >
        No templates match “{{ query }}”.
      </div>
      <div
        v-else-if="!templates.length && view === 'table'"
        class="rounded-[14px] border border-dashed p-12 text-sm text-muted-foreground"
      >
        No templates yet.
      </div>
    </template>

    <ConfirmDialog
      v-model:open="confirmRemoveOpen"
      title="Delete template"
      :description="pendingRemoval ? `Permanently delete template “${pendingRemoval.name}”? Existing agents using it will keep running, but you can no longer create new ones from it.` : ''"
      confirm-label="Delete template"
      @confirm="onRemove"
    />

    <ConfirmDialog
      v-model:open="confirmRestartOpen"
      title="Restart all agents on this template"
      :description="pendingRestart ? `Restart every agent that uses “${pendingRestart.name}”? Each agent's pod will be redeployed with the latest template files (skills, instructions). Runtime state (memory, sessions, workspace) is preserved.` : ''"
      confirm-label="Restart all"
      @confirm="onRestartAgents"
    />
  </div>
</template>
