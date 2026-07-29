<script setup lang="ts">
import type { ISkillData, ISkillExistsConflict } from '#skill/stores/skill';

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
const redeployOpen = ref(false);
const redeployedSkill = ref<ISkillData | null>(null);
const { agents, rows, redeploying, load, start, reset } = useSkillRedeploy();

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
  const dependents = await load(skill.id);
  if (dependents.length === 0) return;
  redeployedSkill.value = skill;
  redeployOpen.value = true;
}

function closeRedeploy() {
  if (redeploying.value) return;
  redeployOpen.value = false;
  redeployedSkill.value = null;
  reset();
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
        <div class="grid min-w-0 flex-1 gap-2">
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

  <SkillImportConflictDialog
    :open="conflictOpen"
    :existing="conflictExisting"
    :overwriting="overwriting"
    @confirm="confirmOverwrite"
    @cancel="cancelOverwrite"
  />

  <SkillRedeployDialog
    :open="redeployOpen"
    :agents="agents"
    :rows="rows"
    :redeploying="redeploying"
    :skill-name="redeployedSkill?.name"
    @start="start"
    @close="closeRedeploy"
  />
</template>
