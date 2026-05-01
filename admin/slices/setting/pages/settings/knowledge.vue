<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import { Input } from '#theme/components/ui/input';
import { Label } from '#theme/components/ui/label';
import { Checkbox } from '#theme/components/ui/checkbox';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';

const SETTING_GROUP = 'knowledge';

interface ITextField {
  name: string;
  label: string;
  type?: 'text' | 'password';
  placeholder?: string;
  description?: string;
}

const TEXT_FIELDS: ITextField[] = [
  {
    name: 'url',
    label: 'Knowledge service URL',
    placeholder: 'http://lightrag.platform.svc.cluster.local:9621',
  },
  {
    name: 'api_key',
    label: 'API key',
    type: 'password',
    placeholder: 'shared secret with the knowledge service',
  },
  {
    name: 's3_bucket',
    label: 'S3 bucket for source files',
    placeholder: 'ranch-reins-sources',
  },
];

const settingStore = useSettingStore();
await useAsyncData('admin-settings-knowledge', () => settingStore.fetchAll());

function readEnabled(): boolean {
  const v = settingStore.get(SETTING_GROUP, 'enabled')?.value;
  if (typeof v === 'boolean') return v;
  return true;
}

function readString(name: string): string {
  const v = settingStore.get(SETTING_GROUP, name)?.value;
  return typeof v === 'string' ? v : '';
}

const enabled = ref<boolean>(readEnabled());
const values = reactive<Record<string, string>>({});
for (const f of TEXT_FIELDS) {
  values[f.name] = readString(f.name);
}

const saving = ref(false);
const savedAt = ref<string | null>(null);
const errorMessage = ref<string | null>(null);

async function onSave(): Promise<void> {
  saving.value = true;
  errorMessage.value = null;
  try {
    const tasks: Promise<unknown>[] = [];

    const currentEnabled = settingStore.get(SETTING_GROUP, 'enabled')?.value;
    const currentEnabledBool =
      typeof currentEnabled === 'boolean' ? currentEnabled : true;
    if (enabled.value !== currentEnabledBool) {
      tasks.push(
        settingStore.upsert(SETTING_GROUP, 'enabled', enabled.value, 'json'),
      );
    }

    for (const f of TEXT_FIELDS) {
      const next = values[f.name] ?? '';
      const current = settingStore.get(SETTING_GROUP, f.name)?.value;
      if (next !== (typeof current === 'string' ? current : '')) {
        tasks.push(settingStore.upsert(SETTING_GROUP, f.name, next, 'string'));
      }
    }

    await Promise.all(tasks);
    savedAt.value = new Date().toLocaleTimeString();
  } catch (err: unknown) {
    const e = err as {
      response?: { data?: { message?: string } };
      message?: string;
    };
    errorMessage.value =
      e?.response?.data?.message ?? e?.message ?? 'Save failed';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <Card>
      <CardHeader>
        <CardTitle>Knowledge service</CardTitle>
        <CardDescription>
          External RAG/knowledge service. Toggle off to disable knowledges
          across the admin and runtime even if the URL is set.
        </CardDescription>
      </CardHeader>
      <CardContent class="grid max-w-xl gap-4">
        <label class="flex items-start gap-3" for="knowledge-enabled">
          <Checkbox
            id="knowledge-enabled"
            :model-value="enabled"
            @update:model-value="(v: boolean | 'indeterminate') => (enabled = v === true)"
          />
          <div class="grid gap-1">
            <Label for="knowledge-enabled" class="cursor-pointer">
              Enable knowledge service
            </Label>
            <p class="text-xs text-muted-foreground">
              When off, /knowledges API returns disabled and the admin hides
              knowledge pickers.
            </p>
            <p class="text-xs text-muted-foreground/70">knowledge/enabled</p>
          </div>
        </label>

        <div v-for="field in TEXT_FIELDS" :key="field.name" class="grid gap-2">
          <Label :for="`knowledge-${field.name}`">{{ field.label }}</Label>
          <Input
            :id="`knowledge-${field.name}`"
            v-model="values[field.name]"
            :type="field.type ?? 'text'"
            :placeholder="field.placeholder"
            :autocomplete="field.type === 'password' ? 'off' : undefined"
          />
          <p v-if="field.description" class="text-xs text-muted-foreground">
            {{ field.description }}
          </p>
          <p class="text-xs text-muted-foreground/70">
            {{ SETTING_GROUP }}/{{ field.name }}
          </p>
        </div>
      </CardContent>
    </Card>

    <div class="flex items-center gap-3">
      <Button :disabled="saving" @click="onSave">
        {{ saving ? 'Saving…' : 'Save changes' }}
      </Button>
      <span v-if="savedAt" class="text-xs text-muted-foreground">
        Saved at {{ savedAt }}
      </span>
      <span v-if="errorMessage" class="text-xs text-destructive">
        {{ errorMessage }}
      </span>
    </div>
  </div>
</template>
