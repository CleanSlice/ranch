<script setup lang="ts">
import type { ICreateAgentData } from '#agent/stores/agent';
import type { ITemplateData } from '#template/stores/template';
import { Button } from '#theme/components/ui/button';
import { Input } from '#theme/components/ui/input';
import { Label } from '#theme/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#theme/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';

const props = defineProps<{
  templates: ITemplateData[];
  llms: { id: string; provider: string; model: string; label: string | null; status: string }[];
  initialValues?: ICreateAgentData;
  submitLabel?: string;
  submitting?: boolean;
  disableTemplate?: boolean;
}>();

const emit = defineEmits<{
  submit: [values: ICreateAgentData];
  cancel: [];
}>();

const firstTemplate = props.templates[0];

// Reka UI disallows empty-string <SelectItem value="">, so the "None"
// option uses a sentinel that we map to/from null at the edges.
const LLM_NONE = '__none__';

const form = reactive<
  Required<Pick<ICreateAgentData, 'name' | 'templateId'>> & {
    llmCredentialId: string;
    resources: { cpu: string; memory: string };
  }
>({
  name: props.initialValues?.name ?? '',
  templateId: props.initialValues?.templateId ?? firstTemplate?.id ?? '',
  llmCredentialId: props.initialValues?.llmCredentialId ?? LLM_NONE,
  resources: {
    cpu: props.initialValues?.resources?.cpu ?? firstTemplate?.defaultResources.cpu ?? '500m',
    memory: props.initialValues?.resources?.memory ?? firstTemplate?.defaultResources.memory ?? '512Mi',
  },
});

watch(
  () => form.templateId,
  (id) => {
    const template = props.templates.find((t) => t.id === id);
    if (!template) return;
    form.resources.cpu = template.defaultResources.cpu;
    form.resources.memory = template.defaultResources.memory;
  },
);

const errors = reactive<Partial<Record<'name' | 'templateId', string>>>({});

function validate() {
  errors.name = form.name.trim() ? undefined : 'Name is required';
  errors.templateId = form.templateId ? undefined : 'Template is required';
  return !errors.name && !errors.templateId;
}

function onSubmit() {
  if (!validate()) return;
  emit('submit', {
    name: form.name.trim(),
    templateId: form.templateId,
    llmCredentialId:
      form.llmCredentialId && form.llmCredentialId !== LLM_NONE
        ? form.llmCredentialId
        : null,
    resources: {
      cpu: form.resources.cpu.trim() || '500m',
      memory: form.resources.memory.trim() || '512Mi',
    },
  });
}
</script>

<template>
  <form class="flex flex-col gap-6" @submit.prevent="onSubmit">
    <Card>
      <CardHeader>
        <CardTitle>Agent details</CardTitle>
        <CardDescription>Name and link to a template blueprint.</CardDescription>
      </CardHeader>
      <CardContent class="grid max-w-xl gap-4">
        <div class="grid gap-2">
          <Label for="name">Name</Label>
          <Input id="name" v-model="form.name" placeholder="Research bot #1" :aria-invalid="!!errors.name" />
          <p v-if="errors.name" class="text-xs text-destructive">{{ errors.name }}</p>
        </div>

        <div class="grid gap-2">
          <Label for="template">Template</Label>
          <Select v-model="form.templateId" :disabled="disableTemplate">
            <SelectTrigger id="template">
              <SelectValue placeholder="Choose a template" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="t in templates" :key="t.id" :value="t.id">
                {{ t.name }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p v-if="errors.templateId" class="text-xs text-destructive">{{ errors.templateId }}</p>
          <p v-if="disableTemplate" class="text-xs text-muted-foreground">
            Template can't be changed after creation.
          </p>
        </div>

        <div class="grid gap-2">
          <Label for="llm">LLM credential</Label>
          <Select v-model="form.llmCredentialId">
            <SelectTrigger id="llm">
              <SelectValue placeholder="None (pod runs without LLM_* env)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="LLM_NONE">None</SelectItem>
              <SelectItem
                v-for="l in llms.filter((c) => c.status === 'active')"
                :key="l.id"
                :value="l.id"
              >
                {{ l.provider }} · {{ l.model }}{{ l.label ? ` (${l.label})` : '' }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p class="text-xs text-muted-foreground">
            Picks which credential's provider/model/apiKey become
            <code>LLM_*</code> env vars on the pod. Manage entries in
            <NuxtLink to="/llms" class="underline">LLMs</NuxtLink>.
          </p>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Resources</CardTitle>
        <CardDescription>Overrides the template defaults.</CardDescription>
      </CardHeader>
      <CardContent class="grid max-w-xl gap-4 sm:grid-cols-2">
        <div class="grid gap-2">
          <Label for="cpu">CPU</Label>
          <Input id="cpu" v-model="form.resources.cpu" placeholder="500m" />
        </div>
        <div class="grid gap-2">
          <Label for="memory">Memory</Label>
          <Input id="memory" v-model="form.resources.memory" placeholder="512Mi" />
        </div>
      </CardContent>
    </Card>

    <div class="flex items-center gap-3">
      <Button type="submit" :disabled="submitting">
        {{ submitting ? 'Saving…' : (submitLabel ?? 'Create agent') }}
      </Button>
      <Button type="button" variant="ghost" @click="emit('cancel')">Cancel</Button>
    </div>
  </form>
</template>
