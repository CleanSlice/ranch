<script setup lang="ts">
import {
  IconCopy,
  IconDotsVertical,
  IconDownload,
  IconPencil,
  IconPlayerPlay,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-vue';
import type { IPaddockScenario } from '#paddock/stores/paddockScenario';
import { agentsLabel } from '#template/utils/templateFormat';
import { draftDiff, sameSet } from '#template/utils/templateList';
import TemplateTile from '../Tile.vue';
import TemplateItemOverview from './Overview.vue';
import TemplateItemUnsavedBar from './UnsavedBar.vue';

/**
 * A template's page (CLEAN-130): header with the tile and the actions, a tab
 * bar with counts, and one tab body. Skills and MCP servers are edited as a
 * draft here and written by the sticky bar, so a change on one tab and a
 * change on the other go in one "Save changes".
 */
const props = defineProps<{ id: string }>();

const route = useRoute();
const router = useRouter();
const runtime = useRuntimeConfig();

const templateStore = useTemplateStore();
const agentStore = useAgentStore();
const skillStore = useSkillStore();
const mcpServerStore = useMcpServerStore();
const knowledgeStore = useKnowledgeStore();
const rancherStore = useRancherStore();
const templateFileStore = useTemplateFileStore();
const paddockScenarioStore = usePaddockScenarioStore();
const confirmStore = useConfirmStore();

// The record is read from the store (docs/state.md); the fetch is awaited
// for its loading state only.
const template = computed(() => templateStore.byId(props.id));
const { pending } = await useAsyncData(`admin-template-${props.id}`, () =>
  templateStore.fetchById(props.id),
);

const { agents } = storeToRefs(agentStore);
const { status: rancherStatus } = storeToRefs(rancherStore);
const { nodes: fileNodes } = storeToRefs(templateFileStore);
const { scenarios } = storeToRefs(paddockScenarioStore);

// Everything the header and the Overview count is loaded lazily: the page is
// readable before the counts arrive. Where a tab makes the same lazy request
// the key is shared so opening it does not repeat the call; the Files and
// Evaluations providers fetch eagerly under their own keys, so these carry
// their own — Nuxt refuses one key with two sets of options.
useAsyncData('admin-templates-agents', () => agentStore.fetchAll(), { lazy: true });
useAsyncData('admin-template-skills-list', () => skillStore.fetchAll(), { lazy: true });
useAsyncData('admin-template-mcps-list', () => mcpServerStore.fetchAll(), { lazy: true });
useAsyncData('admin-template-rancher-status', () => rancherStore.fetchStatus(), { lazy: true });
const { status: filesStatus } = useAsyncData(
  `admin-template-files-count-${props.id}`,
  () => templateFileStore.fetchList(props.id),
  { lazy: true },
);
const { status: evalsStatus } = useAsyncData(
  `admin-template-evals-count-${props.id}`,
  () => paddockScenarioStore.fetchAll({ templateId: props.id }),
  { lazy: true },
);
const [{ data: knowledges }] = await Promise.all([
  useAsyncData(`template-${props.id}-knowledges`, () => knowledgeStore.fetchAll()),
  useAsyncData(`template-${props.id}-knowledge-status`, () => knowledgeStore.fetchStatus()),
]);

const templateAgents = computed(() =>
  agents.value.filter((a) => a.templateId === props.id),
);
const running = computed(
  () => templateAgents.value.filter((a) => a.status === 'running').length,
);
const managed = computed(() => rancherStatus.value?.template?.id === props.id);

// ------------------------------------------------------------------ drafts

const draftSkills = ref<string[]>([]);
const draftMcps = ref<string[]>([]);

watch(
  () => template.value?.skillIds,
  (ids) => (draftSkills.value = [...(ids ?? [])]),
  { immediate: true },
);
watch(
  () => template.value?.mcpServerIds,
  (ids) => (draftMcps.value = [...(ids ?? [])]),
  { immediate: true },
);

const diff = computed(() => {
  const s = draftDiff(template.value?.skillIds ?? [], draftSkills.value);
  const m = draftDiff(template.value?.mcpServerIds ?? [], draftMcps.value);
  return { added: s.added + m.added, removed: s.removed + m.removed };
});
const dirty = computed(() => diff.value.added + diff.value.removed > 0);

const saving = ref(false);
const saveError = ref<string | null>(null);

async function onSave() {
  const t = template.value;
  if (!t) return;
  saving.value = true;
  saveError.value = null;
  try {
    if (!sameSet(t.skillIds, draftSkills.value)) {
      await templateStore.setSkills(t.id, draftSkills.value);
    }
    if (!sameSet(t.mcpServerIds, draftMcps.value)) {
      await templateStore.setMcps(t.id, draftMcps.value);
    }
  } catch (err) {
    const e = err as { message?: string; response?: { data?: { message?: string } } };
    saveError.value = e?.response?.data?.message ?? e?.message ?? 'Save failed';
  } finally {
    saving.value = false;
  }
}

function onDiscard() {
  draftSkills.value = [...(template.value?.skillIds ?? [])];
  draftMcps.value = [...(template.value?.mcpServerIds ?? [])];
  saveError.value = null;
}

onBeforeRouteLeave(async () => {
  if (!dirty.value) return true;
  return confirmStore.ask({
    title: 'Discard unsaved changes?',
    description: 'Skills and MCP servers you toggled are not saved yet. They will be lost if you leave.',
    confirmLabel: 'Discard changes',
    cancelLabel: 'Stay',
    variant: 'destructive',
  });
});

// -------------------------------------------------------------------- tabs

type TabId = 'overview' | 'skills' | 'mcp' | 'knowledge' | 'files' | 'evaluations';
const TAB_IDS: TabId[] = ['overview', 'skills', 'mcp', 'knowledge', 'files', 'evaluations'];

const tab = computed<TabId>(() => {
  const q = route.query.tab;
  return typeof q === 'string' && (TAB_IDS as string[]).includes(q) ? (q as TabId) : 'overview';
});

function selectTab(next: TabId) {
  const query = { ...route.query };
  if (next === 'overview') delete query.tab;
  else query.tab = next;
  void router.replace({ query });
}

const tabs = computed<{ id: TabId; label: string; count: number | null | undefined }[]>(() => [
  { id: 'overview', label: 'Overview', count: undefined },
  { id: 'skills', label: 'Skills', count: draftSkills.value.length },
  { id: 'mcp', label: 'MCP servers', count: draftMcps.value.length },
  { id: 'knowledge', label: 'Knowledge', count: template.value?.defaultKnowledgeIds.length ?? 0 },
  { id: 'files', label: 'Files', count: filesStatus.value === 'success' ? fileNodes.value.length : null },
  {
    id: 'evaluations',
    label: 'Evaluations',
    count:
      evalsStatus.value === 'success'
        ? scenarios.value.filter((s) => s.templateId === props.id).length
        : null,
  },
]);

// ---------------------------------------------------------------- overview

const attachedSkills = computed(() => {
  const ids = new Set(template.value?.skillIds ?? []);
  return skillStore.items.filter((s) => ids.has(s.id));
});
const attachedMcps = computed(() => {
  const ids = new Set(template.value?.mcpServerIds ?? []);
  return mcpServerStore.items.filter((m) => ids.has(m.id));
});

// --------------------------------------------------------------- knowledge

const linkedKnowledges = computed(() => {
  const ids = new Set(template.value?.defaultKnowledgeIds ?? []);
  return (knowledges.value ?? []).filter((k) => ids.has(k.id));
});
const linkedIdsWithoutKnowledges = computed(() => {
  const linkedSet = new Set(linkedKnowledges.value.map((k) => k.id));
  return (template.value?.defaultKnowledgeIds ?? []).filter((id) => !linkedSet.has(id));
});

// ------------------------------------------------------------- evaluations

const evalFormOpen = ref(false);
const evalEditing = ref<IPaddockScenario | null>(null);
const evalListRef = ref<{ refresh: () => Promise<void> } | null>(null);

function onEvalCreate() {
  evalEditing.value = null;
  evalFormOpen.value = true;
}
function onEvalEdit(scenario: IPaddockScenario) {
  evalEditing.value = scenario;
  evalFormOpen.value = true;
}
async function onEvalSaved() {
  await evalListRef.value?.refresh();
}

// ----------------------------------------------------------------- actions

const actionError = ref<string | null>(null);
const restartResult = ref<{ restarted: number; failed: number; total: number } | null>(null);
const busy = ref<'restart' | 'duplicate' | 'download' | 'delete' | null>(null);

async function onRestartAgents() {
  const t = template.value;
  if (!t) return;
  const ok = await confirmStore.ask({
    title: 'Restart all agents on this template',
    description: `Restart every agent that uses “${t.name}”? Each agent's pod will be redeployed with the latest template files (skills, instructions). Runtime state (memory, sessions, workspace) is preserved.`,
    confirmLabel: 'Restart all',
  });
  if (!ok) return;
  busy.value = 'restart';
  actionError.value = null;
  restartResult.value = null;
  try {
    restartResult.value = await templateStore.restartAgents(t.id);
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : 'Failed to restart agents.';
  } finally {
    busy.value = null;
  }
}

async function onDuplicate() {
  const t = template.value;
  if (!t) return;
  const ok = await confirmStore.ask({
    title: 'Duplicate template',
    description: `Create a copy of “${t.name}” with the same image, resources, knowledge bases, skills and MCP servers? Uploaded files and evaluation scenarios are not copied.`,
    confirmLabel: 'Duplicate',
  });
  if (!ok) return;
  busy.value = 'duplicate';
  actionError.value = null;
  try {
    const copy = await templateStore.create({
      name: `${t.name} copy`,
      description: t.description,
      image: t.image,
      defaultConfig: t.defaultConfig,
      defaultResources: { ...t.defaultResources },
      defaultKnowledgeIds: [...t.defaultKnowledgeIds],
    });
    if (t.skillIds.length) await templateStore.setSkills(copy.id, t.skillIds);
    if (t.mcpServerIds.length) await templateStore.setMcps(copy.id, t.mcpServerIds);
    await navigateTo(`/templates/${copy.id}`);
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : 'Failed to duplicate template.';
  } finally {
    busy.value = null;
  }
}

async function onDownload() {
  const t = template.value;
  if (!t) return;
  busy.value = 'download';
  actionError.value = null;
  try {
    const res = await fetch(`${runtime.public.apiUrl}/templates/${t.id}/download`, {
      credentials: 'include',
    });
    if (!res.ok) {
      throw new Error(`Download failed: ${res.status} ${res.statusText}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = t.version ? `${t.id}-v${t.version}.zip` : `${t.id}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : 'Download failed';
  } finally {
    busy.value = null;
  }
}

async function onRemove() {
  const t = template.value;
  if (!t) return;
  const ok = await confirmStore.ask({
    title: 'Delete template',
    description: `Permanently delete template “${t.name}”? Existing agents using it will keep running, but you can no longer create new ones from it.`,
    confirmLabel: 'Delete template',
    variant: 'destructive',
  });
  if (!ok) return;
  busy.value = 'delete';
  actionError.value = null;
  try {
    await templateStore.remove(t.id);
    await navigateTo('/templates');
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : 'Failed to delete template.';
    busy.value = null;
  }
}
</script>

<template>
  <div class="flex flex-col gap-6 pb-24">
    <PageBreadcrumbs
      :items="[{ label: 'Templates', to: '/templates' }, ...(template ? [{ label: template.name }] : [])]"
    />

    <div v-if="pending && !template" class="flex flex-col gap-4">
      <Skeleton class="h-14 w-2/3 rounded-xl" />
      <Skeleton class="h-10 w-full" />
      <Skeleton class="h-64 w-full rounded-[14px]" />
    </div>

    <template v-else-if="template">
      <div class="flex flex-wrap items-start gap-4">
        <TemplateTile :id="template.id" :name="template.name" size="lg" />
        <div class="flex min-w-[280px] flex-1 flex-col gap-2">
          <div class="flex flex-wrap items-center gap-2.5">
            <h1 class="text-[26px] font-semibold tracking-tight">{{ template.name }}</h1>
            <Badge v-if="managed" variant="outline" class="border-violet-200 bg-violet-50 text-[11.5px] text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300">
              Managed by Rancher
            </Badge>
            <span
              class="flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs"
              :class="running ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300' : 'text-muted-foreground'"
            >
              <span class="size-1.5 rounded-full" :class="running ? 'bg-emerald-500' : 'bg-muted-foreground/40'" />
              {{ agentsLabel(running) }}
            </span>
          </div>
          <p class="max-w-3xl text-sm leading-normal text-muted-foreground text-pretty">
            {{ template.description || 'No description.' }}
          </p>
        </div>
        <div class="flex gap-2">
          <Button variant="outline" as-child>
            <NuxtLink :to="`/templates/${template.id}/edit`" class="inline-flex items-center gap-1.5">
              <IconPencil class="size-4" />
              Edit
            </NuxtLink>
          </Button>
          <Button as-child>
            <NuxtLink :to="{ path: '/agents/create', query: { templateId: template.id } }" class="inline-flex items-center gap-1.5">
              <IconPlayerPlay class="size-3.5" />
              Spawn agent
            </NuxtLink>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="outline" class="size-9 p-0" :disabled="busy !== null">
                <span class="sr-only">More actions</span>
                <IconDotsVertical class="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-56">
              <DropdownMenuItem @select="onRestartAgents">
                <IconRefresh class="size-4" />
                Restart {{ templateAgents.length }} agent{{ templateAgents.length === 1 ? '' : 's' }}
              </DropdownMenuItem>
              <DropdownMenuItem @select="onDuplicate">
                <IconCopy class="size-4" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem @select="onDownload">
                <IconDownload class="size-4" />
                Download .agent bundle
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem class="text-destructive focus:text-destructive" @select="onRemove">
                <IconTrash class="size-4" />
                Delete template
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div
        v-if="actionError"
        class="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      >
        {{ actionError }}
      </div>
      <div
        v-if="restartResult"
        class="rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-sm"
      >
        Restart triggered: {{ restartResult.restarted }} restarted,
        {{ restartResult.failed }} failed out of {{ restartResult.total }} agent(s).
      </div>

      <nav class="-mt-1 flex gap-0.5 overflow-x-auto border-b [scrollbar-width:none]" role="tablist">
        <button
          v-for="t in tabs"
          :key="t.id"
          type="button"
          role="tab"
          :aria-selected="tab === t.id"
          class="-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 pb-[11px] pt-2.5 text-[13.5px] transition-colors hover:text-foreground"
          :class="tab === t.id ? 'border-foreground font-medium text-foreground' : 'border-transparent text-muted-foreground'"
          @click="selectTab(t.id)"
        >
          {{ t.label }}
          <span
            v-if="t.count !== undefined"
            class="rounded-full bg-muted px-1.5 py-px font-mono text-[11px] text-muted-foreground"
            :title="t.count === null ? 'Not known yet' : undefined"
          >
            {{ t.count === null ? '…' : t.count }}
          </span>
        </button>
      </nav>

      <TemplateItemOverview
        v-if="tab === 'overview'"
        :template="template"
        :agents="templateAgents"
        :skills="attachedSkills"
        :mcps="attachedMcps"
        @manage-skills="selectTab('skills')"
        @manage-mcps="selectTab('mcp')"
      />

      <TemplateSkillsProvider v-else-if="tab === 'skills'" v-model:selected="draftSkills" />

      <TemplateMcpsProvider v-else-if="tab === 'mcp'" v-model:selected="draftMcps" />

      <div v-else-if="tab === 'knowledge'" class="flex flex-col gap-3">
        <div
          v-if="!template.defaultKnowledgeIds.length"
          class="flex max-w-2xl flex-col items-start gap-2.5 rounded-[14px] border-[1.5px] border-dashed p-10"
        >
          <div class="text-[15px] font-semibold">No knowledge bases attached</div>
          <div class="text-[13.5px] leading-normal text-muted-foreground">
            Agents spawned from this template will be able to query attached knowledge bases through the Knowledge MCP server.
          </div>
          <Button variant="outline" size="sm" class="mt-1.5" as-child>
            <NuxtLink :to="`/templates/${template.id}/edit`">Attach knowledge base</NuxtLink>
          </Button>
        </div>
        <section v-else class="flex flex-col gap-3.5 rounded-[14px] border bg-card p-5">
          <div class="flex items-center">
            <h2 class="text-[15px] font-semibold">Knowledge bases</h2>
            <NuxtLink :to="`/templates/${template.id}/edit`" class="ml-auto text-[13px] text-primary hover:underline">
              Manage →
            </NuxtLink>
          </div>
          <p v-if="!knowledgeStore.enabled" class="text-xs text-muted-foreground">
            Knowledge service is disabled — names cannot be resolved. Showing stored IDs.
          </p>
          <ul class="flex flex-wrap gap-1.5">
            <li
              v-for="k in linkedKnowledges"
              :key="k.id"
              class="flex items-center gap-1.5 rounded-[7px] border px-2 py-1 text-[12.5px]"
            >
              {{ k.name }}
              <span v-if="k.indexStatus !== 'ready'" class="text-[11px] text-muted-foreground/70">{{ k.indexStatus }}</span>
            </li>
            <li
              v-for="id in linkedIdsWithoutKnowledges"
              :key="id"
              class="rounded-[7px] border px-2 py-1 font-mono text-[12px] text-muted-foreground"
            >
              {{ id }}
            </li>
          </ul>
        </section>
      </div>

      <TemplateFileProvider v-else-if="tab === 'files'" :id="template.id" />

      <div v-else-if="tab === 'evaluations'" class="flex flex-col gap-6">
        <p class="text-sm text-muted-foreground">
          Default paddock scenarios for agents created from this template. Agents inherit these and can override them individually.
        </p>
        <PaddockScenarioListProvider
          ref="evalListRef"
          :template-id="template.id"
          @create="onEvalCreate"
          @edit="onEvalEdit"
        />
        <PaddockScenarioFormProvider
          v-model:open="evalFormOpen"
          :template-id="template.id"
          :scenario="evalEditing"
          @saved="onEvalSaved"
        />
      </div>

      <TemplateItemUnsavedBar
        v-if="dirty"
        :added="diff.added"
        :removed="diff.removed"
        :saving="saving"
        :error="saveError"
        @discard="onDiscard"
        @save="onSave"
      />
    </template>

    <div v-else class="rounded-[14px] border border-dashed p-10 text-center text-sm text-muted-foreground">
      Template not found.
    </div>
  </div>
</template>
