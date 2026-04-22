<script setup lang="ts">
import type { ILlmCredentialInput } from '#llm/stores/llm';
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

const props = defineProps<{
  initialValues?: ILlmCredentialInput;
  submitLabel?: string;
  submitting?: boolean;
}>();

const emit = defineEmits<{
  submit: [values: ILlmCredentialInput];
  cancel: [];
}>();

const form = reactive({
  provider: props.initialValues?.provider ?? 'anthropic',
  model: props.initialValues?.model ?? '',
  label: props.initialValues?.label ?? '',
  apiKey: props.initialValues?.apiKey ?? '',
  status: props.initialValues?.status ?? 'active',
});

const errors = reactive<
  Partial<Record<'provider' | 'model' | 'apiKey', string>>
>({});

function validate() {
  errors.provider = form.provider.trim() ? undefined : 'Provider is required';
  errors.model = form.model.trim() ? undefined : 'Model is required';
  errors.apiKey = form.apiKey.trim() ? undefined : 'API key is required';
  return !errors.provider && !errors.model && !errors.apiKey;
}

function onSubmit() {
  if (!validate()) return;
  emit('submit', {
    provider: form.provider.trim(),
    model: form.model.trim(),
    apiKey: form.apiKey.trim(),
    label: form.label.trim() || undefined,
    status: form.status,
  });
}
</script>

<template>
  <form class="flex flex-col gap-6" @submit.prevent="onSubmit">
    <Card>
      <CardHeader>
        <CardTitle>Credential</CardTitle>
        <CardDescription>
          API key is stored plaintext. Agents read the list of active
          credentials on boot via
          <code>GET /agents/:agentId/llms</code> (header
          <code>x-bridle-api-key</code>).
        </CardDescription>
      </CardHeader>
      <CardContent class="grid max-w-xl gap-4">
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="grid gap-2">
            <Label for="provider">Provider</Label>
            <Input
              id="provider"
              v-model="form.provider"
              placeholder="anthropic"
              :aria-invalid="!!errors.provider"
            />
            <p v-if="errors.provider" class="text-xs text-destructive">
              {{ errors.provider }}
            </p>
          </div>
          <div class="grid gap-2">
            <Label for="model">Model</Label>
            <Input
              id="model"
              v-model="form.model"
              placeholder="claude-sonnet-4-6"
              :aria-invalid="!!errors.model"
            />
            <p v-if="errors.model" class="text-xs text-destructive">
              {{ errors.model }}
            </p>
          </div>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="grid gap-2">
            <Label for="label">Label (optional)</Label>
            <Input id="label" v-model="form.label" placeholder="primary" />
          </div>
          <div class="grid gap-2">
            <Label for="status">Status</Label>
            <select
              id="status"
              v-model="form.status"
              class="h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="active">active</option>
              <option value="disabled">disabled</option>
            </select>
          </div>
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
