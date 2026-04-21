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

interface IFieldDef {
  group: string;
  name: string;
  label: string;
  description?: string;
  type?: 'text' | 'password';
  placeholder?: string;
}

const SECTIONS: { title: string; description?: string; fields: IFieldDef[] }[] = [
  {
    title: 'Organization',
    description: 'Name shown across the admin UI.',
    fields: [
      {
        group: 'organization',
        name: 'name',
        label: 'Organization name',
        placeholder: 'Ranch',
      },
    ],
  },
  {
    title: 'Default agent resources',
    description: 'Applied when a template does not specify its own.',
    fields: [
      { group: 'agent_defaults', name: 'cpu', label: 'CPU', placeholder: '500m' },
      { group: 'agent_defaults', name: 'memory', label: 'Memory', placeholder: '512Mi' },
    ],
  },
  {
    title: 'GitHub integration',
    description:
      'Personal Access Token used to pull private images (scopes: read:packages). Configure imagePullSecret manually in your cluster.',
    fields: [
      {
        group: 'integrations',
        name: 'github_username',
        label: 'GitHub username',
        placeholder: 'cleanslice',
      },
      {
        group: 'integrations',
        name: 'github_pat',
        label: 'GitHub PAT',
        type: 'password',
        placeholder: 'ghp_…',
      },
    ],
  },
  {
    title: 'Bridle chat hub',
    description:
      'Agents connect to this URL on startup. Empty = default http://host.k3d.internal:3333 (local k3d reaching host api).',
    fields: [
      {
        group: 'integrations',
        name: 'bridle_url',
        label: 'Bridle URL',
        placeholder: 'http://host.k3d.internal:3333',
      },
      {
        group: 'integrations',
        name: 'bridle_api_key',
        label: 'Bridle API key',
        type: 'password',
        placeholder: 'matches BRIDLE_API_KEY in api/.env',
      },
    ],
  },
  {
    title: 'S3 persistence (MinIO / AWS S3)',
    description:
      'If bucket is set, runtime syncs .agent/ to S3 on shutdown and restores on boot. For local MinIO use endpoint http://cleanslice-ranch-minio-1:9000 (pod DNS name) and bucket ranch-agent-data. Per-agent prefix is computed as agents/{agent-id}.',
    fields: [
      {
        group: 'integrations',
        name: 's3_bucket',
        label: 'S3 bucket',
        placeholder: 'ranch-agent-data',
      },
      {
        group: 'integrations',
        name: 's3_endpoint',
        label: 'S3 endpoint (blank for AWS)',
        placeholder: 'http://cleanslice-ranch-minio-1:9000',
      },
      {
        group: 'integrations',
        name: 'aws_region',
        label: 'AWS region',
        placeholder: 'us-east-1',
      },
      {
        group: 'integrations',
        name: 'aws_access_key_id',
        label: 'AWS access key ID',
        placeholder: 'minioadmin',
      },
      {
        group: 'integrations',
        name: 'aws_secret_access_key',
        label: 'AWS secret access key',
        type: 'password',
        placeholder: 'minioadmin',
      },
    ],
  },
];

const settingStore = useSettingStore();
await useAsyncData('admin-settings', () => settingStore.fetchAll());

const values = reactive<Record<string, string>>({});
const keyOf = (g: string, n: string) => `${g}.${n}`;

for (const section of SECTIONS) {
  for (const f of section.fields) {
    const existing = settingStore.get(f.group, f.name);
    values[keyOf(f.group, f.name)] =
      typeof existing?.value === 'string' ? existing.value : '';
  }
}

const saving = ref(false);
const savedAt = ref<string | null>(null);
const errorMessage = ref<string | null>(null);

async function onSave() {
  saving.value = true;
  errorMessage.value = null;
  try {
    const tasks: Promise<unknown>[] = [];
    for (const section of SECTIONS) {
      for (const f of section.fields) {
        const k = keyOf(f.group, f.name);
        const next = values[k] ?? '';
        const current = settingStore.get(f.group, f.name)?.value;
        if (next !== (typeof current === 'string' ? current : '')) {
          tasks.push(settingStore.upsert(f.group, f.name, next, 'string'));
        }
      }
    }
    await Promise.all(tasks);
    savedAt.value = new Date().toLocaleTimeString();
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } }; message?: string };
    errorMessage.value = e?.response?.data?.message ?? e?.message ?? 'Save failed';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div>
      <h1 class="text-2xl font-semibold">Settings</h1>
      <p class="text-sm text-muted-foreground">Stored as key/value in the database.</p>
    </div>

    <Card v-for="section in SECTIONS" :key="section.title">
      <CardHeader>
        <CardTitle>{{ section.title }}</CardTitle>
        <CardDescription v-if="section.description">{{ section.description }}</CardDescription>
      </CardHeader>
      <CardContent class="grid max-w-xl gap-4">
        <div v-for="field in section.fields" :key="keyOf(field.group, field.name)" class="grid gap-2">
          <Label :for="keyOf(field.group, field.name)">{{ field.label }}</Label>
          <Input
            :id="keyOf(field.group, field.name)"
            v-model="values[keyOf(field.group, field.name)]"
            :type="field.type ?? 'text'"
            :placeholder="field.placeholder"
            :autocomplete="field.type === 'password' ? 'off' : undefined"
          />
          <p class="text-xs text-muted-foreground">{{ field.group }}/{{ field.name }}</p>
        </div>
      </CardContent>
    </Card>

    <div class="flex items-center gap-3">
      <Button :disabled="saving" @click="onSave">
        {{ saving ? 'Saving…' : 'Save changes' }}
      </Button>
      <span v-if="savedAt" class="text-xs text-muted-foreground">Saved at {{ savedAt }}</span>
      <span v-if="errorMessage" class="text-xs text-destructive">{{ errorMessage }}</span>
    </div>
  </div>
</template>
