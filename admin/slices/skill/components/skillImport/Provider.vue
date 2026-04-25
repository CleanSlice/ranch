<script setup lang="ts">
import type { ISkillSearchHit } from '#skill/stores/skill';
import { Button } from '#theme/components/ui/button';
import { Input } from '#theme/components/ui/input';
import { Label } from '#theme/components/ui/label';
import { Badge } from '#theme/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';
import { IconArrowLeft, IconSearch, IconExternalLink } from '@tabler/icons-vue';

const skillStore = useSkillStore();

const query = ref('');
const searching = ref(false);
const error = ref<string | null>(null);
const hits = ref<ISkillSearchHit[]>([]);

const importingPath = ref<string | null>(null);
const imported = ref<Record<string, boolean>>({});

const urlValue = ref('');
const urlImporting = ref(false);
const urlError = ref<string | null>(null);
const urlSuccess = ref<string | null>(null);

async function onSearch() {
  if (query.value.trim().length < 2) {
    error.value = 'Enter at least 2 characters';
    return;
  }
  searching.value = true;
  error.value = null;
  hits.value = [];
  try {
    hits.value = await skillStore.search(query.value.trim());
    if (hits.value.length === 0) error.value = 'No skills found';
  } catch (err) {
    const e = err as { response?: { data?: { message?: string } }; message?: string };
    error.value =
      e?.response?.data?.message ??
      e?.message ??
      'Search failed. Set integrations/github_pat in Settings.';
  } finally {
    searching.value = false;
  }
}

async function onImport(hit: ISkillSearchHit) {
  importingPath.value = hit.path;
  error.value = null;
  try {
    await skillStore.importFromGithub({
      repo: hit.repo,
      path: hit.path,
      name: hit.name,
    });
    imported.value[`${hit.repo}:${hit.path}`] = true;
  } catch (err) {
    const e = err as { response?: { data?: { message?: string } }; message?: string };
    error.value = e?.response?.data?.message ?? e?.message ?? 'Import failed';
  } finally {
    importingPath.value = null;
  }
}

function isImported(hit: ISkillSearchHit) {
  return imported.value[`${hit.repo}:${hit.path}`] === true;
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
      urlSuccess.value = `Imported "${created.name}".`;
      urlValue.value = '';
    }
  } catch (err) {
    const e = err as { response?: { data?: { message?: string } }; message?: string };
    urlError.value = e?.response?.data?.message ?? e?.message ?? 'Import failed';
  } finally {
    urlImporting.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <NuxtLink
      to="/skills"
      class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <IconArrowLeft class="size-4" /> Back to skills
    </NuxtLink>

    <div>
      <h1 class="text-2xl font-semibold">Import skill from GitHub</h1>
      <p class="text-sm text-muted-foreground">
        Searches a curated set of public repos via GitHub Code Search and
        imports the matched <code>SKILL.md</code> into your skill library.
        Requires <code>integrations/github_pat</code> in
        <NuxtLink to="/settings" class="underline">Settings</NuxtLink> with
        <code>read:packages</code> + <code>public_repo</code> scope.
      </p>
    </div>

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

    <Card>
      <CardHeader>
        <CardTitle>Search</CardTitle>
        <CardDescription>
          Sources searched: anthropics/skills · VoltAgent/awesome-agent-skills
          · supabase/agent-skills · agent0ai/agent-zero ·
          Orchestra-Research/AI-research-SKILLs.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form class="flex gap-2" @submit.prevent="onSearch">
          <div class="grid flex-1 gap-2">
            <Label for="q" class="sr-only">Query</Label>
            <Input
              id="q"
              v-model="query"
              placeholder="e.g. pdf, devops, browser, …"
              autocomplete="off"
              @keydown.enter.prevent="onSearch"
            />
          </div>
          <Button type="submit" :disabled="searching">
            <IconSearch v-if="!searching" class="size-4" />
            {{ searching ? 'Searching…' : 'Search' }}
          </Button>
        </form>
        <p v-if="error" class="mt-3 text-xs text-destructive">{{ error }}</p>
      </CardContent>
    </Card>

    <div v-if="hits.length" class="flex w-full min-w-0 flex-col gap-3">
      <Card v-for="hit in hits" :key="`${hit.repo}:${hit.path}`" class="w-full min-w-0 overflow-hidden">
        <CardHeader>
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <CardTitle class="break-words text-base">{{ hit.title }}</CardTitle>
                <Badge variant="outline" class="font-mono text-[11px]">
                  {{ hit.repo }}
                </Badge>
              </div>
              <CardDescription class="mt-1 break-all font-mono text-[11px]">
                {{ hit.path }}
              </CardDescription>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" as-child>
                <a :href="hit.url" target="_blank" rel="noopener">
                  <IconExternalLink class="size-3.5" /> View
                </a>
              </Button>
              <Button
                size="sm"
                :disabled="isImported(hit) || importingPath === hit.path"
                @click="onImport(hit)"
              >
                {{
                  isImported(hit)
                    ? 'Imported'
                    : importingPath === hit.path
                      ? 'Importing…'
                      : 'Import'
                }}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent v-if="hit.snippet" class="min-w-0">
          <pre
            class="whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-2 text-[11px] leading-relaxed"
          >{{ hit.snippet }}</pre>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
