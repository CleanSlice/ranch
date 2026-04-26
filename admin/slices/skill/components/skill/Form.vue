<script setup lang="ts">
import type { ISkillInput } from '#skill/stores/skill';
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

const props = defineProps<{
  initialValues?: ISkillInput;
  submitLabel?: string;
  submitting?: boolean;
  lockName?: boolean;
}>();

const emit = defineEmits<{
  submit: [values: ISkillInput];
  cancel: [];
}>();

const form = reactive({
  name: props.initialValues?.name ?? '',
  title: props.initialValues?.title ?? '',
  description: props.initialValues?.description ?? '',
  body: props.initialValues?.body ?? '',
});

const errors = reactive<
  Partial<Record<'name' | 'title' | 'body', string>>
>({});

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

function validate() {
  errors.name = !form.name.trim()
    ? 'Name is required'
    : !SLUG_RE.test(form.name.trim())
      ? 'Use lowercase letters, digits and dashes (e.g. "devops")'
      : undefined;
  errors.title = form.title.trim() ? undefined : 'Title is required';
  errors.body = form.body.trim() ? undefined : 'Body is required';
  return !errors.name && !errors.title && !errors.body;
}

function onSubmit() {
  if (!validate()) return;
  emit('submit', {
    name: form.name.trim(),
    title: form.title.trim(),
    body: form.body,
    description: form.description.trim() || undefined,
  });
}
</script>

<template>
  <form class="flex flex-col gap-6" @submit.prevent="onSubmit">
    <Card>
      <CardHeader>
        <CardTitle>Skill</CardTitle>
        <CardDescription>
          A skill is a markdown document the agent loads at start. The
          <code>name</code> becomes the directory under <code>.agent/skills/</code>
          inside the pod; the <code>body</code> is its content. Attach skills to
          a template to ship them with every agent of that template.
        </CardDescription>
      </CardHeader>
      <CardContent class="grid max-w-3xl gap-4">
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="grid gap-2">
            <Label for="name">Name (slug)</Label>
            <Input
              id="name"
              v-model="form.name"
              placeholder="devops"
              :disabled="lockName"
              :aria-invalid="!!errors.name"
            />
            <p v-if="errors.name" class="text-xs text-destructive">
              {{ errors.name }}
            </p>
          </div>
          <div class="grid gap-2">
            <Label for="title">Title</Label>
            <Input
              id="title"
              v-model="form.title"
              placeholder="DevOps engineer"
              :aria-invalid="!!errors.title"
            />
            <p v-if="errors.title" class="text-xs text-destructive">
              {{ errors.title }}
            </p>
          </div>
        </div>

        <div class="grid gap-2">
          <Label for="description">Description (optional)</Label>
          <Input
            id="description"
            v-model="form.description"
            placeholder="One-line summary shown in lists"
          />
        </div>

        <div class="grid gap-2">
          <Label for="body">Body (markdown)</Label>
          <Textarea
            id="body"
            v-model="form.body"
            rows="20"
            placeholder="# Skill content&#10;&#10;Instructions, prompts, examples…"
            class="font-mono text-xs"
            :aria-invalid="!!errors.body"
          />
          <p v-if="errors.body" class="text-xs text-destructive">
            {{ errors.body }}
          </p>
        </div>
      </CardContent>
    </Card>

    <div class="flex items-center gap-3">
      <Button type="submit" :disabled="submitting">
        {{ submitting ? 'Saving…' : (submitLabel ?? 'Save skill') }}
      </Button>
      <Button type="button" variant="ghost" @click="emit('cancel')">Cancel</Button>
    </div>
  </form>
</template>
