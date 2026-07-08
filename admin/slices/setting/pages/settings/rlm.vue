<script setup lang="ts">
import type { ILlmCredentialData } from '#llm/stores/llm';
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

const SETTING_GROUP = 'rlm';
const DEFAULT_MAX_ITERATIONS = 8;
const DEFAULT_TIMEOUT_S = 60;

const settingStore = useSettingStore();
const llmStore = useLlmStore();

await Promise.all([
  useAsyncData('admin-settings-rlm', () => settingStore.fetchAll()),
  useAsyncData('admin-settings-rlm-llms', () => llmStore.fetchAll()),
]);

function readEnabled(): boolean {
  const v = settingStore.get(SETTING_GROUP, 'enabled')?.value;
  if (typeof v === 'boolean') return v;
  return true;
}

function readString(name: string): string {
  const v = settingStore.get(SETTING_GROUP, name)?.value;
  return typeof v === 'string' ? v : '';
}

function readNumber(name: string, fallback: number): number {
  const v = settingStore.get(SETTING_GROUP, name)?.value;
  return typeof v === 'number' ? v : fallback;
}

const enabled = ref<boolean>(readEnabled());
const rootCredentialId = ref<string>(readString('root_credential_id'));
const subCredentialId = ref<string>(readString('sub_credential_id'));
const maxIterations = ref<number>(
  readNumber('max_iterations', DEFAULT_MAX_ITERATIONS),
);
const timeoutS = ref<number>(readNumber('timeout_s', DEFAULT_TIMEOUT_S));

const chatCredentials = computed<ILlmCredentialData[]>(() =>
  llmStore.items.filter((c) => c.supportsChat && c.status === 'active'),
);

function credentialLabel(c: ILlmCredentialData): string {
  const tag = c.label !== null && c.label.length > 0 ? ` (${c.label})` : '';
  return `${c.provider} / ${c.model}${tag}`;
}

const saving = ref(false);
const savedAt = ref<string | null>(null);
const errorMessage = ref<string | null>(null);

async function onSave(): Promise<void> {
  if (
    enabled.value &&
    (rootCredentialId.value === '' || subCredentialId.value === '')
  ) {
    errorMessage.value =
      'Pick both a root and a sub model before enabling RLM.';
    return;
  }

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

    const currentRoot = readString('root_credential_id');
    if (rootCredentialId.value !== currentRoot) {
      tasks.push(
        settingStore.upsert(
          SETTING_GROUP,
          'root_credential_id',
          rootCredentialId.value,
          'string',
        ),
      );
    }

    const currentSub = readString('sub_credential_id');
    if (subCredentialId.value !== currentSub) {
      tasks.push(
        settingStore.upsert(
          SETTING_GROUP,
          'sub_credential_id',
          subCredentialId.value,
          'string',
        ),
      );
    }

    if (maxIterations.value !== readNumber('max_iterations', DEFAULT_MAX_ITERATIONS)) {
      tasks.push(
        settingStore.upsert(
          SETTING_GROUP,
          'max_iterations',
          maxIterations.value,
          'json',
        ),
      );
    }

    if (timeoutS.value !== readNumber('timeout_s', DEFAULT_TIMEOUT_S)) {
      tasks.push(
        settingStore.upsert(SETTING_GROUP, 'timeout_s', timeoutS.value, 'json'),
      );
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
        <CardTitle>RLM (Recursive Language Model)</CardTitle>
        <CardDescription>
          Lets agents recursively reason over context too large for a single
          prompt (a whole knowledge base, a large workspace file) instead of
          plain RAG. Runs in a short-lived Argo Job pod, not in the API
          process.
        </CardDescription>
      </CardHeader>
      <CardContent class="grid max-w-xl gap-4">
        <label class="flex items-start gap-3" for="rlm-enabled">
          <Checkbox
            id="rlm-enabled"
            :model-value="enabled"
            @update:model-value="(v: boolean | 'indeterminate') => (enabled = v === true)"
          />
          <div class="grid gap-1">
            <Label for="rlm-enabled" class="cursor-pointer">
              Enable RLM
            </Label>
            <p class="text-xs text-muted-foreground">
              When off, the rlm_query tool is not attached to any agent and
              the chat "RLM" toggle has no effect.
            </p>
            <p class="text-xs text-muted-foreground/70">rlm/enabled</p>
          </div>
        </label>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Root / sub model pair</CardTitle>
        <CardDescription>
          Fixed for the whole platform, not per-agent. The root model
          orchestrates; the sub model answers recursive queries over context
          chunks the root hands it. Pick a cheaper model for sub to control
          cost.
        </CardDescription>
      </CardHeader>
      <CardContent class="grid max-w-xl gap-4">
        <div class="grid gap-2">
          <Label for="rlm-root-credential">Root model</Label>
          <select
            id="rlm-root-credential"
            v-model="rootCredentialId"
            class="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">(unset)</option>
            <option v-for="c in chatCredentials" :key="c.id" :value="c.id">
              {{ credentialLabel(c) }}
            </option>
          </select>
          <p class="text-xs text-muted-foreground/70">
            rlm/root_credential_id
          </p>
        </div>

        <div class="grid gap-2">
          <Label for="rlm-sub-credential">Sub model</Label>
          <select
            id="rlm-sub-credential"
            v-model="subCredentialId"
            class="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">(unset)</option>
            <option v-for="c in chatCredentials" :key="c.id" :value="c.id">
              {{ credentialLabel(c) }}
            </option>
          </select>
          <p class="text-xs text-muted-foreground/70">
            rlm/sub_credential_id
          </p>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Run limits</CardTitle>
        <CardDescription>
          Caps applied to every RLM job pod, regardless of which agent
          triggered it.
        </CardDescription>
      </CardHeader>
      <CardContent class="grid max-w-xl gap-4">
        <div class="grid gap-2">
          <Label for="rlm-max-iterations">Max iterations</Label>
          <Input
            id="rlm-max-iterations"
            v-model.number="maxIterations"
            type="number"
            min="1"
            max="50"
          />
          <p class="text-xs text-muted-foreground/70">
            rlm/max_iterations
          </p>
        </div>

        <div class="grid gap-2">
          <Label for="rlm-timeout">Timeout (seconds)</Label>
          <Input
            id="rlm-timeout"
            v-model.number="timeoutS"
            type="number"
            min="10"
            max="600"
          />
          <p class="text-xs text-muted-foreground/70">rlm/timeout_s</p>
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
