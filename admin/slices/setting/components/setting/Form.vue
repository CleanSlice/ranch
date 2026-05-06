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
  // Localhost / dev default. Pre-filled when no value is saved, and used
  // as the target for the "Reset to localhost values" button.
  default?: string;
}

interface IProps {
  title: string;
  description?: string;
  resetLabel?: string;
  fields: IFieldDef[];
}

const props = defineProps<IProps>();

const settingStore = useSettingStore();
await useAsyncData('admin-settings', () => settingStore.fetchAll());

const keyOf = (g: string, n: string) => `${g}.${n}`;

const values = reactive<Record<string, string>>({});
let anyStored = false;
for (const f of props.fields) {
  const existing = settingStore.get(f.group, f.name);
  const stored = typeof existing?.value === 'string' ? existing.value : '';
  values[keyOf(f.group, f.name)] = stored;
  if (stored) anyStored = true;
}

// Show the "Use localhost values" banner only on a fresh install — if any
// field already has a saved value we assume the operator knows what they're
// doing (likely AWS or a custom MinIO) and the banner becomes noise.
const showLocalHint = computed(
  () => !anyStored && props.fields.some((f) => f.default !== undefined),
);

function resetToDefaults() {
  for (const f of props.fields) {
    if (f.default !== undefined) {
      values[keyOf(f.group, f.name)] = f.default;
    }
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
    for (const f of props.fields) {
      const k = keyOf(f.group, f.name);
      const next = values[k] ?? '';
      const current = settingStore.get(f.group, f.name)?.value;
      if (next !== (typeof current === 'string' ? current : '')) {
        tasks.push(settingStore.upsert(f.group, f.name, next, 'string'));
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
    <Card>
      <CardHeader>
        <CardTitle>{{ title }}</CardTitle>
        <CardDescription v-if="description">{{ description }}</CardDescription>
      </CardHeader>
      <div
        v-if="showLocalHint"
        class="mx-6 mb-4 flex items-center justify-between gap-4 rounded-md border border-dashed bg-muted/40 px-4 py-3 text-sm"
      >
        <span class="text-muted-foreground">
          Local install? Pre-fill all fields with bundled defaults (MinIO,
          localhost) — useful for first-time <code>make dev</code> setup.
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          @click="resetToDefaults"
        >
          {{ resetLabel ?? 'Use localhost values' }}
        </Button>
      </div>
      <CardContent class="grid max-w-xl gap-4">
        <div
          v-for="field in fields"
          :key="keyOf(field.group, field.name)"
          class="grid gap-2"
        >
          <Label :for="keyOf(field.group, field.name)">{{ field.label }}</Label>
          <Input
            :id="keyOf(field.group, field.name)"
            v-model="values[keyOf(field.group, field.name)]"
            :type="field.type ?? 'text'"
            :placeholder="field.placeholder"
            :autocomplete="field.type === 'password' ? 'off' : undefined"
          />
          <p v-if="field.description" class="text-xs text-muted-foreground">
            {{ field.description }}
          </p>
          <p class="text-xs text-muted-foreground/70">
            {{ field.group }}/{{ field.name }}
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
