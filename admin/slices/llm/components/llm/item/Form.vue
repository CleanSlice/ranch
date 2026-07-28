<script setup lang="ts">
import type { ILlmCredentialInput } from '#llm/stores/llm';
import {
  PROVIDERS,
  getProvider,
  getModel,
  isKnownProvider,
} from '#llm/data/providers';
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

const props = defineProps<{
  initialValues?: ILlmCredentialInput;
  submitLabel?: string;
  submitting?: boolean;
}>();

const emit = defineEmits<{
  submit: [values: ILlmCredentialInput];
  cancel: [];
}>();

const initialProvider = props.initialValues?.provider ?? 'claude';
const initialModel = props.initialValues?.model ?? '';
const initialFallback = props.initialValues?.fallbackModel ?? '';

const form = reactive({
  provider: initialProvider,
  model: initialModel,
  fallbackModel: initialFallback,
  label: props.initialValues?.label ?? '',
  apiKey: props.initialValues?.apiKey ?? '',
  status: props.initialValues?.status ?? 'active',
  supportsChat: props.initialValues?.supportsChat ?? true,
  supportsEmbedding: props.initialValues?.supportsEmbedding ?? false,
});

const errors = reactive<
  Partial<Record<'provider' | 'model' | 'apiKey' | 'capabilities', string>>
>({});

const providerHasCustom = computed(() => !isKnownProvider(form.provider));

const modelOptions = computed(() => {
  const provider = getProvider(form.provider);
  if (provider === null) return [];
  return provider.models.map((m) => ({
    id: m.id,
    label: m.label,
  }));
});


function onProviderChange(): void {
  form.model = '';
  form.fallbackModel = '';
}

function onModelChange(): void {
  const def = getModel(form.provider, form.model);
  if (def === null) return;
  form.supportsChat = def.capabilities.chat;
  form.supportsEmbedding = def.capabilities.embedding;
}

function validate(): boolean {
  errors.provider = form.provider.trim() ? undefined : 'Provider is required';
  errors.model = form.model.trim() ? undefined : 'Model is required';
  errors.apiKey = form.apiKey.trim() ? undefined : 'API key is required';
  errors.capabilities =
    !form.supportsChat && !form.supportsEmbedding
      ? 'Pick at least one capability'
      : undefined;
  return (
    !errors.provider && !errors.model && !errors.apiKey && !errors.capabilities
  );
}

function onSubmit(): void {
  if (!validate()) return;
  emit('submit', {
    provider: form.provider.trim(),
    model: form.model.trim(),
    fallbackModel: form.fallbackModel.trim() || undefined,
    apiKey: form.apiKey.trim(),
    label: form.label.trim() || undefined,
    status: form.status,
    supportsChat: form.supportsChat,
    supportsEmbedding: form.supportsEmbedding,
  });
}
</script>

<template>
  <form class="flex flex-col gap-6" @submit.prevent="onSubmit">
    <Card>
      <CardHeader>
        <CardTitle>Credential</CardTitle>
        <CardDescription>
          API key is stored plaintext. When assigned to an agent, these values
          are injected as <code>LLM_PROVIDER</code>, <code>LLM_MODEL</code>,
          <code>LLM_FALLBACK_MODEL</code>, <code>LLM_API_KEY</code> on the pod.
          Mark which task this credential is for: chat (LLM completions) or
          embedding (vector search). Knowledge service picks credentials by
          these flags.
        </CardDescription>
      </CardHeader>
      <CardContent class="grid max-w-xl gap-4">
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="grid gap-2">
            <Label for="provider">Provider</Label>
            <select
              id="provider"
              v-model="form.provider"
              class="h-9 rounded-md border bg-background px-3 text-sm"
              :aria-invalid="!!errors.provider"
              @change="onProviderChange"
            >
              <option v-for="p in PROVIDERS" :key="p.id" :value="p.id">
                {{ p.label }}
              </option>
              <option v-if="providerHasCustom" :value="form.provider">
                {{ form.provider }} (custom)
              </option>
            </select>
            <p v-if="errors.provider" class="text-xs text-destructive">
              {{ errors.provider }}
            </p>
          </div>
          <div class="grid gap-2">
            <Label for="model">Model</Label>
            <input
              id="model"
              list="model-list"
              v-model="form.model"
              class="h-9 rounded-md border bg-background px-3 text-sm"
              :aria-invalid="!!errors.model"
              placeholder="Pick a model or type custom"
              @change="onModelChange"
            />
            <datalist id="model-list">
              <option v-for="m in modelOptions" :key="m.id" :value="m.id">
                {{ m.label }}
              </option>
            </datalist>
            <p v-if="errors.model" class="text-xs text-destructive">
              {{ errors.model }}
            </p>
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div class="grid gap-2">
            <Label for="fallbackModel">Fallback model (optional)</Label>
            <input
              id="fallbackModel"
              list="fallback-model-list"
              v-model="form.fallbackModel"
              class="h-9 rounded-md border bg-background px-3 text-sm"
              placeholder="Pick a fallback or type custom"
            />
            <datalist id="fallback-model-list">
              <option v-for="m in modelOptions" :key="m.id" :value="m.id">
                {{ m.label }}
              </option>
            </datalist>
          </div>
          <div class="grid gap-2">
            <Label for="label">Label (optional)</Label>
            <Input id="label" v-model="form.label" placeholder="primary" />
          </div>
        </div>

        <div class="grid gap-2">
          <Label>Capabilities</Label>
          <label class="flex items-center gap-2 text-sm" for="cap-chat">
            <Checkbox
              id="cap-chat"
              :model-value="form.supportsChat"
              @update:model-value="
                (v: boolean | 'indeterminate') => (form.supportsChat = v === true)
              "
            />
            Use for chat (agent invocations)
          </label>
          <label class="flex items-center gap-2 text-sm" for="cap-embedding">
            <Checkbox
              id="cap-embedding"
              :model-value="form.supportsEmbedding"
              @update:model-value="
                (v: boolean | 'indeterminate') =>
                  (form.supportsEmbedding = v === true)
              "
            />
            Use for embedding (Knowledge / RAG)
          </label>
          <p v-if="errors.capabilities" class="text-xs text-destructive">
            {{ errors.capabilities }}
          </p>
          <p class="text-xs text-muted-foreground">
            Picking a model from the dropdown auto-fills these flags from the
            model's known capabilities. Override here if needed.
          </p>
        </div>

        <div class="grid gap-2">
          <Label for="status">Status</Label>
          <select
            id="status"
            v-model="form.status"
            class="h-9 rounded-md border bg-background px-3 text-sm max-w-xs"
          >
            <option value="active">active</option>
            <option value="disabled">disabled</option>
          </select>
        </div>

        <div class="grid gap-2">
          <Label for="apiKey">API key</Label>
          <Input
            id="apiKey"
            v-model="form.apiKey"
            type="password"
            autocomplete="off"
            placeholder="sk-ant-… / sk-…"
            :aria-invalid="!!errors.apiKey"
          />
          <p v-if="errors.apiKey" class="text-xs text-destructive">
            {{ errors.apiKey }}
          </p>
        </div>
      </CardContent>
    </Card>

    <div class="flex items-center gap-3">
      <Button type="submit" :disabled="submitting">
        {{ submitting ? 'Saving…' : (submitLabel ?? 'Create credential') }}
      </Button>
      <Button type="button" variant="ghost" @click="emit('cancel')">Cancel</Button>
    </div>
  </form>
</template>
