<script setup lang="ts">
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

const skillStore = useSkillStore();

const urlValue = ref('');
const urlImporting = ref(false);
const urlError = ref<string | null>(null);
const urlSuccess = ref<string | null>(null);

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
</template>
