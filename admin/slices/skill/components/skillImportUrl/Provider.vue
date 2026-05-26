<script setup lang="ts">
import type {
  ISkillData,
  ISkillDependentAgent,
  ISkillExistsConflict,
} from '#skill/stores/skill';
import { AgentsService } from '#api/data';
import { Button } from '#theme/components/ui/button';
import { Input } from '#theme/components/ui/input';
import { Label } from '#theme/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui';
import {
  IconExternalLink,
  IconLoader2,
  IconCheck,
  IconX,
} from '@tabler/icons-vue';

const skillStore = useSkillStore();

const urlValue = ref('');
const urlImporting = ref(false);
const urlError = ref<string | null>(null);
const urlSuccess = ref<string | null>(null);

// Conflict (skill-exists) modal
const conflictOpen = ref(false);
const conflictExisting = ref<ISkillExistsConflict['existing'] | null>(null);
const overwriting = ref(false);

// Redeploy modal (shown after a successful overwrite if dependent agents exist)
type RedeployStatus = 'pending' | 'running' | 'done' | 'failed';
interface RedeployRow {
  agent: ISkillDependentAgent;
  status: RedeployStatus;
  error?: string;
}
const redeployOpen = ref(false);
const redeployedSkill = ref<ISkillData | null>(null);
const dependentAgents = ref<ISkillDependentAgent[]>([]);
const redeployRows = ref<RedeployRow[]>([]);
const redeploying = ref(false);

const redeployProgress = computed(() => {
  const total = redeployRows.value.length;
  const settled = redeployRows.value.filter(
    (r) => r.status === 'done' || r.status === 'failed',
  ).length;
  return { total, settled };
});

function parseConflict(err: unknown): ISkillExistsConflict | null {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (
    data &&
    typeof data === 'object' &&
    (data as { code?: string }).code === 'SKILL_EXISTS' &&
    (data as { existing?: unknown }).existing
  ) {
    return data as ISkillExistsConflict;
  }
  return null;
}

function readErrorMessage(err: unknown): string {
  const e = err as {
    response?: { data?: { message?: string | string[] } };
    message?: string;
  };
  const raw = e?.response?.data?.message;
  if (Array.isArray(raw)) return raw.join('; ');
  return raw ?? e?.message ?? 'Import failed';
}

async function onImportUrl() {
  const trimmed = urlValue.value.trim();
  if (!trimmed) return;
  urlImporting.value = true;
  urlError.value = null;
  urlSuccess.value = null;
  try {
    const created = await skillStore.importFromUrl({ url: trimmed });
    if (created) {
      await onImportFinished(created);
    }
  } catch (err) {
    const conflict = parseConflict(err);
    if (conflict) {
      conflictExisting.value = conflict.existing;
      conflictOpen.value = true;
    } else {
      urlError.value = readErrorMessage(err);
    }
  } finally {
    urlImporting.value = false;
  }
}

async function confirmOverwrite() {
  if (overwriting.value || !conflictExisting.value) return;
  const trimmed = urlValue.value.trim();
  if (!trimmed) return;
  overwriting.value = true;
  try {
    const updated = await skillStore.importFromUrl({
      url: trimmed,
      overwrite: true,
    });
    conflictOpen.value = false;
    conflictExisting.value = null;
    if (updated) {
      await onImportFinished(updated, { overwritten: true });
    }
  } catch (err) {
    urlError.value = readErrorMessage(err);
    conflictOpen.value = false;
    conflictExisting.value = null;
  } finally {
    overwriting.value = false;
  }
}

function cancelOverwrite() {
  if (overwriting.value) return;
  conflictOpen.value = false;
  conflictExisting.value = null;
}

async function onImportFinished(
  skill: ISkillData,
  opts: { overwritten?: boolean } = {},
) {
  urlSuccess.value = opts.overwritten
    ? `Overwrote "${skill.name}".`
    : `Imported "${skill.name}".`;
  urlValue.value = '';

  if (!opts.overwritten) return;

  // Overwriting may invalidate the bundled skill copy baked into running
  // agent pods. Fetch dependents so the operator can redeploy them.
  const agents = await skillStore.fetchDependentAgents(skill.id);
  if (agents.length === 0) return;
  redeployedSkill.value = skill;
  dependentAgents.value = agents;
  redeployRows.value = [];
  redeployOpen.value = true;
}

async function startRedeploy() {
  if (redeploying.value || dependentAgents.value.length === 0) return;
  redeploying.value = true;
  redeployRows.value = dependentAgents.value.map((agent) => ({
    agent,
    status: 'pending',
  }));
  // Sequential — see skillEdit Provider: keeps per-agent feedback honest and
  // avoids slamming the scheduler with parallel pod evictions.
  for (const row of redeployRows.value) {
    row.status = 'running';
    try {
      await AgentsService.agentControllerRestart({
        path: { id: row.agent.id },
      });
      row.status = 'done';
    } catch (err) {
      row.status = 'failed';
      row.error = (err as Error).message;
    }
  }
  redeploying.value = false;
}

function closeRedeploy() {
  if (redeploying.value) return;
  redeployOpen.value = false;
  redeployedSkill.value = null;
  dependentAgents.value = [];
  redeployRows.value = [];
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Import by URL</CardTitle>
      <CardDescription>
        Paste any GitHub link — to a folder
        (<code>github.com/owner/repo/tree/&lt;ref&gt;/path</code>) or a
        <code>SKILL.md</code> file. The whole folder
        (<code>SKILL.md</code> + <code>references/*</code> etc.) is bundled.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <form class="flex gap-2" @submit.prevent="onImportUrl">
        <div class="grid flex-1 gap-2 min-w-0">
          <Label for="url" class="sr-only">URL</Label>
          <Input
            id="url"
            v-model="urlValue"
            type="url"
            placeholder="https://github.com/supabase/agent-skills/tree/main/skills/supabase-postgres-best-practices"
            autocomplete="off"
          />
        </div>
        <Button type="submit" :disabled="urlImporting || !urlValue.trim()">
          {{ urlImporting ? 'Importing…' : 'Import' }}
        </Button>
      </form>
      <p v-if="urlError" class="mt-3 text-xs text-destructive">{{ urlError }}</p>
      <p v-if="urlSuccess" class="mt-3 text-xs text-emerald-600">{{ urlSuccess }}</p>
    </CardContent>
  </Card>

  <!-- Conflict modal: skill with the same slug already exists -->
  <DialogRoot
    :open="conflictOpen"
    @update:open="(v) => (v ? (conflictOpen = true) : cancelOverwrite())"
  >
    <DialogPortal>
      <DialogOverlay
        class="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/80"
      />
      <DialogContent
        class="bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-1/2 left-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border p-6 shadow-lg duration-200"
      >
        <div class="flex flex-col gap-1">
          <DialogTitle class="text-foreground text-lg font-semibold">
            Skill already exists
          </DialogTitle>
          <DialogDescription class="text-muted-foreground text-sm">
            A skill with the slug
            <code v-if="conflictExisting">{{ conflictExisting.name }}</code>
            is already installed. Overwriting will fully replace its content,
            files and source.
          </DialogDescription>
        </div>

        <div
          v-if="conflictExisting"
          class="grid gap-2 rounded-md border bg-muted/20 p-3 text-sm"
        >
          <div>
            <div class="font-medium">{{ conflictExisting.title }}</div>
            <div class="text-xs text-muted-foreground">
              <code>{{ conflictExisting.name }}</code>
            </div>
          </div>
          <p
            v-if="conflictExisting.description"
            class="text-xs text-muted-foreground"
          >
            {{ conflictExisting.description }}
          </p>
          <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Updated {{ formatTimestamp(conflictExisting.updatedAt) }}</span>
            <a
              v-if="conflictExisting.source"
              :href="conflictExisting.source"
              target="_blank"
              rel="noopener"
              class="inline-flex items-center gap-1 underline"
            >
              current source <IconExternalLink class="size-3" />
            </a>
          </div>
        </div>

        <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            :disabled="overwriting"
            @click="cancelOverwrite"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            :disabled="overwriting"
            @click="confirmOverwrite"
          >
            <IconLoader2 v-if="overwriting" class="size-4 animate-spin" />
            {{ overwriting ? 'Overwriting…' : 'Overwrite' }}
          </Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>

  <!-- Post-overwrite redeploy modal -->
  <DialogRoot
    :open="redeployOpen"
    @update:open="(v) => (v ? (redeployOpen = true) : closeRedeploy())"
  >
    <DialogPortal>
      <DialogOverlay
        class="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/80"
      />
      <DialogContent
        class="bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-1/2 left-1/2 z-50 grid w-full max-w-xl -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border p-6 shadow-lg duration-200"
      >
        <div class="flex flex-col gap-1">
          <DialogTitle class="text-foreground text-lg font-semibold">
            Redeploy agents using this skill?
          </DialogTitle>
          <DialogDescription class="text-muted-foreground text-sm">
            <template v-if="redeployRows.length === 0">
              {{ dependentAgents.length }} agent{{ dependentAgents.length === 1 ? '' : 's' }}
              use<span v-if="dependentAgents.length === 1">s</span>
              <code v-if="redeployedSkill">{{ redeployedSkill.name }}</code>
              via templates. They keep running the previous version until
              restarted.
            </template>
            <template v-else-if="redeploying">
              Redeploying {{ redeployProgress.settled }} / {{ redeployProgress.total }}…
            </template>
            <template v-else>
              Redeploy finished — {{ redeployProgress.settled }} / {{ redeployProgress.total }} processed.
            </template>
          </DialogDescription>
        </div>

        <ul
          v-if="redeployRows.length > 0"
          class="max-h-72 overflow-y-auto rounded-md border bg-muted/20 p-3"
        >
          <li
            v-for="row in redeployRows"
            :key="row.agent.id"
            class="flex items-center gap-2 py-1 text-sm"
          >
            <IconLoader2
              v-if="row.status === 'running'"
              class="size-4 shrink-0 animate-spin text-primary"
            />
            <IconCheck
              v-else-if="row.status === 'done'"
              class="size-4 shrink-0 text-emerald-600"
            />
            <IconX
              v-else-if="row.status === 'failed'"
              class="size-4 shrink-0 text-destructive"
            />
            <span
              v-else
              class="inline-block size-4 shrink-0 rounded-full border border-muted-foreground/30"
            />
            <span class="truncate font-medium">{{ row.agent.name }}</span>
            <span class="shrink-0 text-xs text-muted-foreground">
              ({{ row.agent.templateName }})
            </span>
            <span
              v-if="row.error"
              class="ml-auto truncate text-xs text-destructive"
            >
              {{ row.error }}
            </span>
          </li>
        </ul>

        <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            v-if="!redeploying"
            variant="outline"
            @click="closeRedeploy"
          >
            {{ redeployRows.length === 0 ? 'Skip' : 'Close' }}
          </Button>
          <Button
            v-if="dependentAgents.length > 0 && redeployRows.length === 0"
            @click="startRedeploy"
          >
            Redeploy {{ dependentAgents.length }} agent{{ dependentAgents.length === 1 ? '' : 's' }}
          </Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
