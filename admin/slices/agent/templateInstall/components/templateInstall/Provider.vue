<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  useTemplateInstallStore,
  type IInstallManifest,
  type IInstallPreview,
  type IInstallResult,
  type IInstallParamValues,
  type IManifestParam,
  type IManifestSecret,
} from '#templateInstall/stores/templateInstall';

type WizardStep = 'source' | 'preview' | 'configure' | 'result';
type SourceKind = 'zip' | 'git';

const store = useTemplateInstallStore();

const step = ref<WizardStep>('source');
const sourceKind = ref<SourceKind>('zip');

const zipFile = ref<File | null>(null);
const gitUrl = ref('https://github.com/CleanSlice/agent-templates.git');
const gitRef = ref('main');

const paramValues = ref<IInstallParamValues>({});
const secretValues = ref<Record<string, string>>({});

const preview = ref<IInstallPreview | null>(null);
const result = ref<IInstallResult | null>(null);

const busy = ref(false);
const errorMsg = ref<string | null>(null);

const manifest = computed<IInstallManifest | null>(() => preview.value?.manifest ?? null);
const params = computed<IManifestParam[]>(() => manifest.value?.params ?? []);
const secrets = computed<IManifestSecret[]>(() => manifest.value?.secrets ?? []);

const groupedParams = computed(() => groupBy(params.value));
const groupedSecrets = computed(() => groupBy(secrets.value));

function groupBy<T extends { groupId?: string; groupLabel?: string; groupHint?: string }>(items: T[]) {
  const groups = new Map<string, { id: string; label: string; hint?: string; items: T[] }>();
  for (const item of items) {
    const id = item.groupId ?? '_default';
    const existing = groups.get(id);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(id, {
        id,
        label: item.groupLabel ?? '',
        hint: item.groupHint,
        items: [item],
      });
    }
  }
  return Array.from(groups.values());
}

function reset() {
  step.value = 'source';
  preview.value = null;
  result.value = null;
  paramValues.value = {};
  secretValues.value = {};
  errorMsg.value = null;
}

async function runPreview() {
  errorMsg.value = null;
  busy.value = true;
  try {
    const p =
      sourceKind.value === 'zip'
        ? await previewZip()
        : await store.previewFromGit(gitUrl.value, gitRef.value || undefined, {});
    preview.value = p;
    // Seed param defaults from manifest so the form is pre-filled.
    paramValues.value = (p.manifest.params ?? []).reduce(
      (acc, param) => {
        if (param.default !== undefined) acc[param.name] = param.default;
        return acc;
      },
      {} as IInstallParamValues,
    );
    secretValues.value = {};
    step.value = 'preview';
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

async function previewZip(): Promise<IInstallPreview> {
  if (!zipFile.value) throw new Error('Pick a zip file first');
  return store.previewFromZip(zipFile.value, {});
}

function goConfigure() {
  step.value = 'configure';
}

async function runInstall() {
  errorMsg.value = null;
  busy.value = true;
  try {
    const r =
      sourceKind.value === 'zip'
        ? await installZip()
        : await store.installFromGit(
            gitUrl.value,
            gitRef.value || undefined,
            paramValues.value,
            secretValues.value,
          );
    result.value = r;
    step.value = 'result';
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

async function installZip(): Promise<IInstallResult> {
  if (!zipFile.value) throw new Error('Pick a zip file first');
  return store.installFromZip(
    zipFile.value,
    paramValues.value,
    secretValues.value,
  );
}

function onZipPicked(e: Event) {
  const target = e.target as HTMLInputElement;
  zipFile.value = target.files?.[0] ?? null;
}

function onZipDropped(e: DragEvent) {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (file && file.name.endsWith('.zip')) zipFile.value = file;
}
</script>

<template>
  <div class="flex flex-col gap-6 max-w-3xl">
    <div>
      <h1 class="text-2xl font-semibold">Install template</h1>
      <p class="text-sm text-muted-foreground">
        Install a Ranch agent template from a zip archive or a git repository.
      </p>
    </div>

    <!-- Step indicator -->
    <div class="flex items-center gap-2 text-xs text-muted-foreground">
      <span :class="step === 'source' ? 'font-semibold text-foreground' : ''">1. Source</span>
      <span>›</span>
      <span :class="step === 'preview' ? 'font-semibold text-foreground' : ''">2. Preview</span>
      <span>›</span>
      <span :class="step === 'configure' ? 'font-semibold text-foreground' : ''">3. Configure</span>
      <span>›</span>
      <span :class="step === 'result' ? 'font-semibold text-foreground' : ''">4. Done</span>
    </div>

    <Card v-if="errorMsg" class="border-destructive">
      <CardContent class="p-4 text-sm text-destructive">{{ errorMsg }}</CardContent>
    </Card>

    <!-- STEP 1: SOURCE -->
    <Card v-if="step === 'source'">
      <CardHeader>
        <CardTitle>Pick a source</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col gap-4">
        <div class="flex gap-2">
          <Button
            :variant="sourceKind === 'zip' ? 'default' : 'outline'"
            @click="sourceKind = 'zip'"
          >
            Upload zip
          </Button>
          <Button
            :variant="sourceKind === 'git' ? 'default' : 'outline'"
            @click="sourceKind = 'git'"
          >
            Git URL
          </Button>
        </div>

        <div v-if="sourceKind === 'zip'" class="flex flex-col gap-2">
          <Label>Template archive (.zip)</Label>
          <div
            class="border-2 border-dashed rounded-lg p-6 text-center text-sm text-muted-foreground"
            @dragover.prevent
            @drop="onZipDropped"
          >
            <p v-if="zipFile" class="text-foreground">
              {{ zipFile.name }} ({{ Math.round(zipFile.size / 1024) }} KB)
            </p>
            <p v-else>Drop a .zip here, or pick one below.</p>
          </div>
          <Input type="file" accept=".zip,application/zip" @change="onZipPicked" />
        </div>

        <div v-if="sourceKind === 'git'" class="flex flex-col gap-3">
          <div>
            <Label for="gitUrl">Git URL</Label>
            <Input
              id="gitUrl"
              v-model="gitUrl"
              placeholder="https://github.com/org/repo.git"
            />
          </div>
          <div>
            <Label for="gitRef">Ref (branch / tag, optional)</Label>
            <Input id="gitRef" v-model="gitRef" placeholder="main" />
          </div>
        </div>

        <div class="flex justify-end">
          <Button :disabled="busy" @click="runPreview">
            {{ busy ? 'Loading…' : 'Preview' }}
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- STEP 2: PREVIEW -->
    <Card v-if="step === 'preview' && preview">
      <CardHeader>
        <CardTitle>{{ preview.manifest.metadata.name }}</CardTitle>
        <p class="text-sm text-muted-foreground">
          {{ preview.manifest.metadata.id }} v{{ preview.manifest.metadata.version }} ·
          {{ preview.willCreate ? 'New install' : 'Upgrade' }}
        </p>
      </CardHeader>
      <CardContent class="flex flex-col gap-4">
        <p class="text-sm">{{ preview.manifest.metadata.description }}</p>

        <div class="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div class="text-muted-foreground">Files</div>
            <div>{{ preview.files.agentFiles }} agent · {{ preview.files.scenarioFiles }} scenarios</div>
          </div>
          <div>
            <div class="text-muted-foreground">Skills · MCP</div>
            <div>{{ preview.declared.skills.length }} · {{ preview.declared.mcp.length }}</div>
          </div>
        </div>

        <div v-if="preview.declared.secrets.length > 0">
          <div class="text-sm text-muted-foreground mb-1">Secrets requested:</div>
          <ul class="text-sm list-disc pl-5">
            <li v-for="s in preview.declared.secrets" :key="s.name">
              {{ s.name }}{{ s.required ? ' (required)' : '' }}
            </li>
          </ul>
        </div>

        <div v-if="preview.warnings.length > 0">
          <div class="text-sm text-amber-600 font-medium mb-1">Warnings:</div>
          <ul class="text-sm list-disc pl-5 text-amber-600">
            <li v-for="(w, i) in preview.warnings" :key="i">{{ w }}</li>
          </ul>
        </div>

        <div class="flex justify-between">
          <Button variant="outline" @click="reset">Change source</Button>
          <Button @click="goConfigure">Configure & install</Button>
        </div>
      </CardContent>
    </Card>

    <!-- STEP 3: CONFIGURE -->
    <Card v-if="step === 'configure' && manifest">
      <CardHeader>
        <CardTitle>Configure</CardTitle>
        <p class="text-sm text-muted-foreground">
          Fill in any params or secrets the template requested.
        </p>
      </CardHeader>
      <CardContent class="flex flex-col gap-6">
        <!-- params -->
        <div v-if="params.length > 0" class="flex flex-col gap-4">
          <h3 class="text-sm font-medium">Parameters</h3>
          <div v-for="g in groupedParams" :key="g.id" class="flex flex-col gap-3">
            <div v-if="g.label">
              <div class="text-sm font-medium">{{ g.label }}</div>
              <div v-if="g.hint" class="text-xs text-muted-foreground">{{ g.hint }}</div>
            </div>
            <div v-for="p in g.items" :key="p.name" class="flex flex-col gap-1">
              <Label :for="`param-${p.name}`">
                {{ p.label ?? p.name }}{{ p.required === false ? '' : ' *' }}
              </Label>
              <Select
                v-if="p.type === 'enum'"
                :model-value="String(paramValues[p.name] ?? p.default ?? '')"
                @update:model-value="(v) => (paramValues[p.name] = v as string)"
              >
                <SelectTrigger :id="`param-${p.name}`">
                  <SelectValue :placeholder="p.placeholder ?? 'Choose…'" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="v in p.values ?? []" :key="v" :value="v">
                    {{ v }}
                  </SelectItem>
                </SelectContent>
              </Select>
              <Input
                v-else-if="p.type === 'string' || p.type === 'number'"
                :id="`param-${p.name}`"
                :type="p.type === 'number' ? 'number' : 'text'"
                :placeholder="p.placeholder"
                :model-value="paramValues[p.name] as string | number | undefined"
                @update:model-value="
                  (v) =>
                    (paramValues[p.name] = p.type === 'number' ? Number(v) : (v as string))
                "
              />
              <input
                v-else-if="p.type === 'boolean'"
                :id="`param-${p.name}`"
                type="checkbox"
                :checked="Boolean(paramValues[p.name])"
                @change="(e) => (paramValues[p.name] = (e.target as HTMLInputElement).checked)"
              />
              <p v-if="p.hint" class="text-xs text-muted-foreground">{{ p.hint }}</p>
            </div>
          </div>
        </div>

        <!-- secrets -->
        <div v-if="secrets.length > 0" class="flex flex-col gap-4">
          <h3 class="text-sm font-medium">Secrets</h3>
          <p class="text-xs text-muted-foreground">
            Secrets are stored separately and never written to template files. They are referenced
            by the agent at runtime via environment variables.
          </p>
          <div v-for="g in groupedSecrets" :key="g.id" class="flex flex-col gap-3">
            <div v-if="g.label">
              <div class="text-sm font-medium">{{ g.label }}</div>
              <div v-if="g.hint" class="text-xs text-muted-foreground">{{ g.hint }}</div>
            </div>
            <div v-for="s in g.items" :key="s.name" class="flex flex-col gap-1">
              <Label :for="`secret-${s.name}`">
                {{ s.label ?? s.name }}{{ s.required === false ? '' : ' *' }}
              </Label>
              <Input
                :id="`secret-${s.name}`"
                v-model="secretValues[s.name]"
                type="password"
                :placeholder="s.placeholder"
              />
              <p v-if="s.hint" class="text-xs text-muted-foreground">{{ s.hint }}</p>
              <a
                v-if="s.docsUrl"
                :href="s.docsUrl"
                target="_blank"
                class="text-xs text-primary underline w-fit"
              >
                docs ↗
              </a>
            </div>
          </div>
          <p class="text-xs text-amber-600">
            Note: secret persistence is wired in the API contract but the per-agent secret store
            UI is pending. For now secrets you enter here are not yet sent to the runtime.
          </p>
        </div>

        <div v-if="params.length === 0 && secrets.length === 0" class="text-sm text-muted-foreground">
          This template has no params or secrets. Click install to proceed.
        </div>

        <div class="flex justify-between">
          <Button variant="outline" @click="step = 'preview'">Back</Button>
          <Button :disabled="busy" @click="runInstall">
            {{ busy ? 'Installing…' : 'Install' }}
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- STEP 4: RESULT -->
    <Card v-if="step === 'result' && result">
      <CardHeader>
        <CardTitle>Installed</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col gap-3">
        <p class="text-sm">
          <NuxtLink :to="`/templates/${result.templateId}`" class="text-primary underline">
            {{ result.templateName }}
          </NuxtLink>
          is now available.
        </p>
        <div class="text-sm text-muted-foreground">
          {{ result.filesUploaded }} files uploaded · {{ result.scenariosSeeded }} paddock scenarios
          seeded · {{ result.skillsAttached.length }} skills · {{ result.mcpAttached.length }} MCP
          servers attached
        </div>

        <div v-if="result.unresolvedSkills.length > 0 || result.unresolvedMcp.length > 0">
          <div class="text-sm text-amber-600 font-medium">Unresolved:</div>
          <ul class="text-sm list-disc pl-5 text-amber-600">
            <li v-for="s in result.unresolvedSkills" :key="`s-${s}`">skill not found: {{ s }}</li>
            <li v-for="m in result.unresolvedMcp" :key="`m-${m}`">mcp not found: {{ m }}</li>
          </ul>
        </div>

        <div v-if="result.warnings.length > 0">
          <div class="text-sm text-amber-600 font-medium">Warnings:</div>
          <ul class="text-sm list-disc pl-5 text-amber-600">
            <li v-for="(w, i) in result.warnings" :key="i">{{ w }}</li>
          </ul>
        </div>

        <div class="flex justify-end gap-2">
          <Button variant="outline" @click="reset">Install another</Button>
          <NuxtLink :to="`/templates/${result.templateId}`">
            <Button>View template</Button>
          </NuxtLink>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
