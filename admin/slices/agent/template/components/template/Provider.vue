<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import { Badge } from '#theme/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';
import { IconArrowLeft, IconDownload, IconRefresh } from '@tabler/icons-vue';
import type { IPaddockScenario } from '#paddock/stores/paddockScenario';

const props = defineProps<{ id: string }>();
const templateStore = useTemplateStore();
const knowledgeStore = useKnowledgeStore();
const runtime = useRuntimeConfig();
const downloadingTemplate = ref(false);
const downloadError = ref<string | null>(null);

async function onDownload() {
  if (!template.value) return;
  downloadingTemplate.value = true;
  downloadError.value = null;
  try {
    const res = await fetch(
      `${runtime.public.apiUrl}/templates/${template.value.id}/download`,
      { credentials: 'include' },
    );
    if (!res.ok) {
      throw new Error(`Download failed: ${res.status} ${res.statusText}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = template.value.version
      ? `${template.value.id}-v${template.value.version}.zip`
      : `${template.value.id}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    downloadError.value = err instanceof Error ? err.message : 'Download failed';
  } finally {
    downloadingTemplate.value = false;
  }
}

const [{ data: template, pending, refresh }, { data: knowledges }] =
  await Promise.all([
    useAsyncData(`admin-template-${props.id}`, () =>
      templateStore.fetchById(props.id),
    ),
    useAsyncData(`template-${props.id}-knowledges`, () =>
      knowledgeStore.fetchAll(),
    ),
    useAsyncData(`template-${props.id}-knowledge-status`, () =>
      knowledgeStore.fetchStatus(),
    ),
  ]);

const linkedKnowledges = computed(() => {
  const ids = new Set(template.value?.defaultKnowledgeIds ?? []);
  return (knowledges.value ?? []).filter((k) => ids.has(k.id));
});

const linkedIdsWithoutKnowledges = computed(() => {
  const linkedSet = new Set(linkedKnowledges.value.map((k) => k.id));
  return (template.value?.defaultKnowledgeIds ?? []).filter(
    (id) => !linkedSet.has(id),
  );
});

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

type SectionId = 'blueprint' | 'skills' | 'mcps' | 'knowledges' | 'files' | 'evaluations';

const sections: { id: SectionId; title: string; description: string }[] = [
  { id: 'blueprint', title: 'Blueprint', description: 'Image and resource defaults.' },
  { id: 'skills', title: 'Skills', description: 'Attach skills available to this template.' },
  { id: 'mcps', title: 'MCP servers', description: 'Tool servers agents inherit from this template.' },
  { id: 'knowledges', title: 'Knowledges', description: 'Bases agents created from this template can query.' },
  { id: 'files', title: 'Files', description: 'The .agent folder uploaded to S3.' },
  { id: 'evaluations', title: 'Evaluations', description: 'Default paddock scenarios for agents from this template.' },
];

const active = ref<SectionId>('blueprint');

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

const confirmRemoveOpen = ref(false);

async function onRemove(): Promise<void> {
  if (!template.value) return;
  await templateStore.remove(template.value.id);
  await navigateTo('/templates');
}

const confirmRestartOpen = ref(false);
const restarting = ref(false);
const restartError = ref<string | null>(null);
const restartResult = ref<{ restarted: number; failed: number; total: number } | null>(null);

async function onRestartAgents() {
  if (!template.value) return;
  restarting.value = true;
  restartError.value = null;
  restartResult.value = null;
  try {
    restartResult.value = await templateStore.restartAgents(template.value.id);
  } catch (err: unknown) {
    restartError.value = err instanceof Error ? err.message : 'Failed to restart agents.';
  } finally {
    restarting.value = false;
  }
}

async function onSkillsSaved() {
  await refresh();
}

async function onMcpsSaved() {
  await refresh();
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <NuxtLink to="/templates" class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <IconArrowLeft class="size-4" /> Back to templates
    </NuxtLink>

    <div v-if="pending" class="text-sm text-muted-foreground">Loading…</div>

    <template v-else-if="template">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold">{{ template.name }}</h1>
          <p class="text-sm text-muted-foreground">{{ template.description }}</p>
        </div>
        <div class="flex gap-2">
          <Button variant="outline" :disabled="downloadingTemplate" @click="onDownload">
            <IconDownload class="size-4" />
            {{ downloadingTemplate ? 'Downloading…' : 'Download' }}
          </Button>
          <Button
            variant="outline"
            :disabled="restarting"
            @click="confirmRestartOpen = true"
          >
            <IconRefresh class="size-4" :class="restarting && 'animate-spin'" />
            {{ restarting ? 'Restarting…' : 'Restart agents' }}
          </Button>
          <Button variant="outline" as-child>
            <NuxtLink :to="`/templates/${template.id}/edit`">Edit</NuxtLink>
          </Button>
          <Button variant="ghost" class="text-destructive" @click="confirmRemoveOpen = true">Delete</Button>
        </div>
      </div>

      <div
        v-if="downloadError"
        class="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      >
        {{ downloadError }}
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
        Restart triggered: {{ restartResult.restarted }} restarted,
        {{ restartResult.failed }} failed out of {{ restartResult.total }} agent(s).
      </div>

      <ConfirmDialog
        v-model:open="confirmRemoveOpen"
        title="Delete template"
        :description="`Permanently delete template “${template.name}”? Existing agents using it will keep running, but you can no longer create new ones from it.`"
        confirm-label="Delete template"
        @confirm="onRemove"
      />

      <ConfirmDialog
        v-model:open="confirmRestartOpen"
        title="Restart all agents on this template"
        :description="`Restart every agent that uses “${template.name}”? Each agent's pod will be redeployed with the latest template files (skills, instructions). Runtime state (memory, sessions, workspace) is preserved.`"
        confirm-label="Restart all"
        @confirm="onRestartAgents"
      />

      <div class="grid gap-8 md:grid-cols-[16rem_1fr]">
        <aside>
          <nav class="flex flex-col gap-1">
            <button
              v-for="section in sections"
              :key="section.id"
              type="button"
              class="group rounded-md border border-transparent px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
              :class="active === section.id ? 'border-border bg-muted' : ''"
              @click="active = section.id"
            >
              <span class="block font-medium">{{ section.title }}</span>
              <span class="block text-xs text-muted-foreground">
                {{ section.description }}
              </span>
            </button>
          </nav>
        </aside>

        <section class="min-w-0">
          <Card v-if="active === 'blueprint'">
            <CardHeader>
              <CardTitle>Blueprint</CardTitle>
              <CardDescription>Defaults applied when spawning an agent from this template.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div class="sm:col-span-2">
                  <dt class="text-xs text-muted-foreground">Image</dt>
                  <dd class="mt-1">
                    <code class="text-sm">{{ template.image }}</code>
                  </dd>
                </div>
                <div>
                  <dt class="text-xs text-muted-foreground">Default CPU</dt>
                  <dd class="mt-1">
                    <Badge variant="outline">{{ template.defaultResources.cpu }}</Badge>
                  </dd>
                </div>
                <div>
                  <dt class="text-xs text-muted-foreground">Default memory</dt>
                  <dd class="mt-1">
                    <Badge variant="outline">{{ template.defaultResources.memory }}</Badge>
                  </dd>
                </div>
                <div>
                  <dt class="text-xs text-muted-foreground">Created</dt>
                  <dd class="mt-1 text-sm">{{ formatDate(template.createdAt) }}</dd>
                </div>
                <div>
                  <dt class="text-xs text-muted-foreground">Last updated</dt>
                  <dd class="mt-1 text-sm">{{ formatDate(template.updatedAt) }}</dd>
                </div>
                <div>
                  <dt class="text-xs text-muted-foreground">ID</dt>
                  <dd class="mt-1 text-sm text-muted-foreground">{{ template.id }}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card v-else-if="active === 'skills'">
            <CardHeader>
              <CardTitle>Skills</CardTitle>
              <CardDescription>
                Pick which skills this template carries. Saved as a full set —
                unchecked skills are detached. Manage skill content in
                <NuxtLink to="/skills" class="underline">Skills</NuxtLink>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TemplateSkillsProvider
                :template-id="template.id"
                :initial-skill-ids="template.skillIds"
                @saved="onSkillsSaved"
              />
            </CardContent>
          </Card>

          <Card v-else-if="active === 'mcps'">
            <CardHeader>
              <CardTitle>MCP servers</CardTitle>
              <CardDescription>
                Pick which MCP servers agents created from this template should connect to.
                Saved as a full set — unchecked servers are detached. Register new servers in
                <NuxtLink to="/mcps" class="underline">MCP servers</NuxtLink>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TemplateMcpsProvider
                :template-id="template.id"
                :initial-mcp-server-ids="template.mcpServerIds"
                @saved="onMcpsSaved"
              />
            </CardContent>
          </Card>

          <Card v-else-if="active === 'knowledges'">
            <CardHeader>
              <CardTitle>Knowledges</CardTitle>
              <CardDescription>
                Bases agents created from this template can query.
              </CardDescription>
            </CardHeader>
            <CardContent class="grid gap-3">
              <p
                v-if="!knowledgeStore.enabled && template.defaultKnowledgeIds.length"
                class="text-xs text-muted-foreground"
              >
                Knowledge service is disabled — names cannot be resolved. Showing
                stored IDs.
              </p>
              <p
                v-if="!template.defaultKnowledgeIds.length"
                class="text-sm text-muted-foreground"
              >
                None linked.
              </p>
              <ul v-else class="flex flex-wrap gap-2">
                <li v-for="k in linkedKnowledges" :key="k.id">
                  <Badge variant="outline">{{ k.name }}</Badge>
                </li>
                <li
                  v-for="id in linkedIdsWithoutKnowledges"
                  :key="id"
                  class="text-xs text-muted-foreground"
                >
                  <Badge variant="outline">{{ id }}</Badge>
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card v-else-if="active === 'files'">
            <CardHeader>
              <CardTitle>Files</CardTitle>
              <CardDescription>
                Upload a .agent folder to populate this template, then edit individual
                files in the browser.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TemplateFileProvider :id="template.id" />
            </CardContent>
          </Card>

          <Card v-else-if="active === 'evaluations'">
            <CardHeader>
              <CardTitle>Evaluations</CardTitle>
              <CardDescription>
                Default paddock scenarios for agents created from this template.
                Agents inherit these and can override them individually.
              </CardDescription>
            </CardHeader>
            <CardContent class="flex flex-col gap-6">
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
            </CardContent>
          </Card>
        </section>
      </div>
    </template>

    <div v-else class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
      Template not found.
    </div>
  </div>
</template>
