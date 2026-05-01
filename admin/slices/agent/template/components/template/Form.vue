<script setup lang="ts">
import type { ICreateTemplateData } from '#template/stores/template';
import type { IKnowledge } from '#reins/stores/knowledge';
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
  knowledges: IKnowledge[];
  knowledgeServiceEnabled: boolean;
  initialValues?: ICreateTemplateData;
  submitLabel?: string;
  submitting?: boolean;
}>();

const emit = defineEmits<{
  submit: [values: ICreateTemplateData];
  cancel: [];
}>();

const form = reactive<{
  name: string;
  description: string;
  image: string;
  defaultResources: { cpu: string; memory: string };
  defaultKnowledgeIds: string[];
}>({
  name: props.initialValues?.name ?? '',
  description: props.initialValues?.description ?? '',
  image: props.initialValues?.image ?? '',
  defaultResources: {
    cpu: props.initialValues?.defaultResources?.cpu ?? '500m',
    memory: props.initialValues?.defaultResources?.memory ?? '512Mi',
  },
  defaultKnowledgeIds: [...(props.initialValues?.defaultKnowledgeIds ?? [])],
});

const errors = reactive<Partial<Record<'name' | 'image', string>>>({});

function validate(): boolean {
  errors.name = form.name.trim() ? undefined : 'Name is required';
  errors.image = form.image.trim() ? undefined : 'Image is required';
  return !errors.name && !errors.image;
}

function toggleKnowledge(id: string, checked: boolean | 'indeterminate'): void {
  if (checked === true) {
    if (!form.defaultKnowledgeIds.includes(id)) {
      form.defaultKnowledgeIds.push(id);
    }
  } else {
    form.defaultKnowledgeIds = form.defaultKnowledgeIds.filter(
      (x) => x !== id,
    );
  }
}

function onSubmit(): void {
  if (!validate()) return;
  emit('submit', {
    name: form.name.trim(),
    description: form.description.trim(),
    image: form.image.trim(),
    defaultResources: {
      cpu: form.defaultResources.cpu.trim() || '500m',
      memory: form.defaultResources.memory.trim() || '512Mi',
    },
    defaultKnowledgeIds: [...form.defaultKnowledgeIds],
  });
}
</script>

<template>
  <form class="flex flex-col gap-6" @submit.prevent="onSubmit">
    <Card>
      <CardHeader>
        <CardTitle>Template details</CardTitle>
        <CardDescription>Name and describe the blueprint.</CardDescription>
      </CardHeader>
      <CardContent class="grid max-w-xl gap-4">
        <div class="grid gap-2">
          <Label for="name">Name</Label>
          <Input id="name" v-model="form.name" placeholder="researcher" :aria-invalid="!!errors.name" />
          <p v-if="errors.name" class="text-xs text-destructive">{{ errors.name }}</p>
        </div>
        <div class="grid gap-2">
          <Label for="description">Description</Label>
          <Input id="description" v-model="form.description" placeholder="Short summary" />
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Runtime</CardTitle>
        <CardDescription>Container image and default resources.</CardDescription>
      </CardHeader>
      <CardContent class="grid max-w-xl gap-4">
        <div class="grid gap-2">
          <Label for="image">Image</Label>
          <Input id="image" v-model="form.image" placeholder="ghcr.io/org/agent:tag" :aria-invalid="!!errors.image" />
          <p v-if="errors.image" class="text-xs text-destructive">{{ errors.image }}</p>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="grid gap-2">
            <Label for="cpu">Default CPU</Label>
            <Input id="cpu" v-model="form.defaultResources.cpu" placeholder="500m" />
          </div>
          <div class="grid gap-2">
            <Label for="memory">Default memory</Label>
            <Input id="memory" v-model="form.defaultResources.memory" placeholder="512Mi" />
          </div>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Knowledges</CardTitle>
        <CardDescription>
          Knowledge bases agents spawned from this template can query at runtime.
        </CardDescription>
      </CardHeader>
      <CardContent class="grid max-w-xl gap-3">
        <p
          v-if="!knowledgeServiceEnabled"
          class="text-xs text-muted-foreground"
        >
          Knowledge service is disabled. Configure the URL in
          <NuxtLink to="/settings" class="underline">Settings</NuxtLink>
          to attach knowledges.
        </p>
        <p
          v-else-if="!knowledges.length"
          class="text-xs text-muted-foreground"
        >
          No knowledges yet. Create one in
          <NuxtLink to="/knowledges" class="underline">Knowledges</NuxtLink>.
        </p>
        <div
          v-else
          class="flex max-h-64 flex-col gap-2 overflow-auto rounded-md border p-3"
        >
          <label
            v-for="k in knowledges"
            :key="k.id"
            class="flex cursor-pointer items-start gap-3"
          >
            <Checkbox
              :model-value="form.defaultKnowledgeIds.includes(k.id)"
              @update:model-value="(v) => toggleKnowledge(k.id, v)"
            />
            <div class="grid gap-0.5">
              <span class="text-sm font-medium">{{ k.name }}</span>
              <span
                v-if="k.description"
                class="text-xs text-muted-foreground"
              >{{ k.description }}</span>
              <span
                v-if="k.indexStatus !== 'ready'"
                class="text-xs text-muted-foreground"
              >Index: {{ k.indexStatus }}</span>
            </div>
          </label>
        </div>
      </CardContent>
    </Card>

    <div class="flex items-center gap-3">
      <Button type="submit" :disabled="submitting">
        {{ submitting ? 'Saving…' : (submitLabel ?? 'Create template') }}
      </Button>
      <Button type="button" variant="ghost" @click="emit('cancel')">Cancel</Button>
    </div>
  </form>
</template>
