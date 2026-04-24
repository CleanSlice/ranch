<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import { Input } from '#theme/components/ui/input';
import { Label } from '#theme/components/ui/label';
import { Textarea } from '#theme/components/ui/textarea';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';

export interface IKnowledgeFormValues {
  name: string;
  description?: string;
}

const props = defineProps<{
  initialValues?: { name: string; description?: string | null };
  submitLabel?: string;
  submitting?: boolean;
}>();

const emit = defineEmits<{
  submit: [values: IKnowledgeFormValues];
  cancel: [];
}>();

const form = reactive({
  name: props.initialValues?.name ?? '',
  description: props.initialValues?.description ?? '',
});

const errors = reactive<Partial<Record<'name', string>>>({});

function validate(): boolean {
  const name = form.name.trim();
  if (!name) {
    errors.name = 'Name is required';
  } else if (name.length < 2) {
    errors.name = 'Name must be at least 2 characters';
  } else {
    errors.name = undefined;
  }
  return !errors.name;
}

function onSubmit() {
  if (!validate()) return;
  emit('submit', {
    name: form.name.trim(),
    description: form.description.trim() || undefined,
  });
}
</script>

<template>
  <form class="flex flex-col gap-6" @submit.prevent="onSubmit">
    <Card>
      <CardHeader>
        <CardTitle>Knowledge base</CardTitle>
        <CardDescription>
          Sources and graph configuration are edited after creation.
        </CardDescription>
      </CardHeader>
      <CardContent class="grid max-w-xl gap-4">
        <div class="grid gap-2">
          <Label for="name">Name</Label>
          <Input
            id="name"
            v-model="form.name"
            placeholder="e.g. Product FAQ"
            :aria-invalid="!!errors.name"
          />
          <p v-if="errors.name" class="text-xs text-destructive">
            {{ errors.name }}
          </p>
        </div>
        <div class="grid gap-2">
          <Label for="description">Description</Label>
          <Textarea
            id="description"
            v-model="form.description"
            rows="3"
            placeholder="Optional"
          />
        </div>
      </CardContent>
    </Card>

    <div class="flex items-center gap-3">
      <Button type="submit" :disabled="submitting">
        {{ submitting ? 'Saving…' : (submitLabel ?? 'Create') }}
      </Button>
      <Button type="button" variant="ghost" @click="emit('cancel')">Cancel</Button>
    </div>
  </form>
</template>
