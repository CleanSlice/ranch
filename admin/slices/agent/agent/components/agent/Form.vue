<script setup lang="ts">
import type { ICreateAgentData } from '#agent/stores/agent';
import type { ITemplateData } from '#template/stores/template';
import type { IKnowledge } from '#reins/stores/knowledge';
import { Button } from '#theme/components/ui/button';
import { Checkbox } from '#theme/components/ui/checkbox';
import { Input } from '#theme/components/ui/input';
import { Label } from '#theme/components/ui/label';
import { Textarea } from '#theme/components/ui/textarea';
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
  knowledges: IKnowledge[];
  knowledgeServiceEnabled: boolean;
  initialValues?: ICreateAgentData;
  submitLabel?: string;
  submitting?: boolean;
  disableTemplate?: boolean;
  // When true the form renders no Save/Cancel row — the host page drives
  // submission via a button with `form="agent-form"` (see agentEdit).
  hideActions?: boolean;
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
    isPublic: boolean;
    allowedOriginsText: string;
    knowledgeIds: string[];
  }
>({
  name: props.initialValues?.name ?? '',
  templateId: props.initialValues?.templateId ?? firstTemplate?.id ?? '',
  llmCredentialId: props.initialValues?.llmCredentialId ?? LLM_NONE,
  resources: {
    cpu: props.initialValues?.resources?.cpu ?? firstTemplate?.defaultResources.cpu ?? '500m',
    memory: props.initialValues?.resources?.memory ?? firstTemplate?.defaultResources.memory ?? '512Mi',
  },
  isPublic: props.initialValues?.isPublic ?? false,
  allowedOriginsText: (props.initialValues?.allowedOrigins ?? []).join('\n'),
  knowledgeIds: [...(props.initialValues?.knowledgeIds ?? [])],
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

function parseOrigins(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

function toggleKnowledge(id: string, checked: boolean | 'indeterminate'): void {
  if (checked === true) {
    if (!form.knowledgeIds.includes(id)) {
      form.knowledgeIds.push(id);
    }
  } else {
    form.knowledgeIds = form.knowledgeIds.filter((x) => x !== id);
  }
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
    isPublic: form.isPublic,
    allowedOrigins: form.isPublic ? parseOrigins(form.allowedOriginsText) : [],
    knowledgeIds: [...form.knowledgeIds],
  });
}
</script>

<template>
  <form id="agent-form" class="flex flex-col gap-6" @submit.prevent="onSubmit">
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
        <CardTitle>Knowledge bases (override)</CardTitle>
        <CardDescription>
          Knowledge bases this agent can query at runtime. Leave empty to inherit from the template.
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
        <template v-else>
          <p class="text-xs text-muted-foreground">
            Leave empty to inherit from template.
          </p>
          <div
            class="flex max-h-64 flex-col gap-2 overflow-auto rounded-md border p-3"
          >
            <label
              v-for="k in knowledges"
              :key="k.id"
              class="flex cursor-pointer items-start gap-3"
            >
              <Checkbox
                :model-value="form.knowledgeIds.includes(k.id)"
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
        </template>
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

    <Card>
      <CardHeader>
        <CardTitle>Visibility</CardTitle>
        <CardDescription>
          Public agents appear on the marketing landing page to unauthenticated visitors.
        </CardDescription>
      </CardHeader>
      <CardContent class="grid max-w-xl gap-4">
        <label for="isPublic" class="flex items-start gap-3 text-sm">
          <Checkbox
            id="isPublic"
            :model-value="form.isPublic"
            @update:model-value="(v: boolean | 'indeterminate') => (form.isPublic = v === true)"
          />
          <span>
            <span class="font-medium">Show on landing page</span>
            <span class="block text-xs text-muted-foreground">
              When off, the agent stays hidden from `/` and the public agent list.
            </span>
          </span>
        </label>

        <div v-if="form.isPublic" class="grid gap-2">
          <Label for="allowedOrigins">Allowed origins</Label>
          <Textarea
            id="allowedOrigins"
            v-model="form.allowedOriginsText"
            rows="4"
            placeholder="https://bridle.cleanslice.org&#10;http://localhost:5173"
          />
          <p class="text-xs text-muted-foreground">
            One origin per line (scheme + host + optional port, no path). Browser sites at these origins
            can open chat WebSockets without a JWT. Leave empty to require a token even when public.
          </p>
        </div>
      </CardContent>
    </Card>

    <div v-if="!hideActions" class="flex items-center gap-3">
      <Button type="submit" :disabled="submitting">
        {{ submitting ? 'Saving…' : (submitLabel ?? 'Create agent') }}
      </Button>
      <Button type="button" variant="ghost" @click="emit('cancel')">Cancel</Button>
    </div>
  </form>
</template>
