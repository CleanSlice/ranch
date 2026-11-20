<script setup lang="ts">
import type { ICreateAgentData } from '#agent/stores/agent';
import type { ITemplateData } from '#template/stores/template';
import type { IKnowledge } from '#reins/stores/knowledge';

// The form for CREATING an agent. An existing agent is edited in place on its
// Overview (CLEAN-228); the Edit page that also used this form is retired, and
// its edit-only props went with it.
const props = defineProps<{
  templates: ITemplateData[];
  llms: { id: string; provider: string; model: string; label: string | null; status: string }[];
  knowledges: IKnowledge[];
  knowledgeServiceEnabled: boolean;
  initialValues?: ICreateAgentData;
  submitLabel?: string;
  submitting?: boolean;
}>();

const emit = defineEmits<{
  submit: [values: ICreateAgentData];
  cancel: [];
}>();

const firstTemplate = props.templates[0];

// Live headroom hint for the Resources fields. Values are burst limits, so
// the useful ceiling is the largest free chunk on one agent node — not a
// hard cap, just honest context while picking numbers.
const agentStore = useAgentStore();
const capacity = computed(() => agentStore.capacity);
onMounted(() => {
  void agentStore.fetchCapacity();
});

function formatCpuMilli(m: number): string {
  return m >= 1000 ? `${parseFloat((m / 1000).toFixed(1))} CPU` : `${m}m`;
}

function formatMemBytes(b: number): string {
  const gi = 1024 ** 3;
  if (b >= gi) return `${parseFloat((b / gi).toFixed(1))}Gi`;
  return `${Math.round(b / 1024 ** 2)}Mi`;
}

// Reka UI disallows empty-string <SelectItem value="">, so the "None"
// option uses a sentinel that we map to/from null at the edges.
const LLM_NONE = '__none__';

const form = reactive<
  Required<Pick<ICreateAgentData, 'name' | 'templateId'>> & {
    description: string;
    llmCredentialId: string;
    resources: { cpu: string; memory: string };
    knowledgeIds: string[];
  }
>({
  name: props.initialValues?.name ?? '',
  description:
    typeof props.initialValues?.config?.description === 'string'
      ? props.initialValues.config.description
      : '',
  templateId: props.initialValues?.templateId ?? firstTemplate?.id ?? '',
  llmCredentialId: props.initialValues?.llmCredentialId ?? LLM_NONE,
  resources: {
    cpu: props.initialValues?.resources?.cpu ?? firstTemplate?.defaultResources.cpu ?? '500m',
    memory: props.initialValues?.resources?.memory ?? firstTemplate?.defaultResources.memory ?? '512Mi',
  },
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

function onSubmit() {
  if (!validate()) return;
  const description = form.description.trim();
  const prevConfig =
    props.initialValues?.config && typeof props.initialValues.config === 'object'
      ? { ...props.initialValues.config }
      : {};
  // The A2A agent card (CLEAN-74) and the share page (CLEAN-237) read
  // config.description. Empty clears the override so both fall back to the
  // template description.
  if (description) prevConfig.description = description;
  else delete prevConfig.description;
  emit('submit', {
    name: form.name.trim(),
    templateId: form.templateId,
    llmCredentialId:
      form.llmCredentialId && form.llmCredentialId !== LLM_NONE
        ? form.llmCredentialId
        : null,
    config: prevConfig,
    resources: {
      cpu: form.resources.cpu.trim() || '500m',
      memory: form.resources.memory.trim() || '512Mi',
    },
    // Visibility is not this form's (CLEAN-224): an agent is created
    // private, and public / origins / limits are saved together on its
    // Overview (Access and Request limit).
    knowledgeIds: [...form.knowledgeIds],
  });
}
</script>

<template>
  <form id="agent-form" class="flex flex-col gap-6" @submit.prevent="onSubmit">
    <Card>
      <CardHeader>
        <CardTitle>Agent details</CardTitle>
        <CardDescription>
          Name, what this agent does (shown on its A2A card and its share
          link), and template.
        </CardDescription>
      </CardHeader>
      <CardContent class="grid max-w-xl gap-4">
        <div class="grid gap-2">
          <Label for="name">Name</Label>
          <Input id="name" v-model="form.name" placeholder="Research bot #1" :aria-invalid="!!errors.name" />
          <p v-if="errors.name" class="text-xs text-destructive">{{ errors.name }}</p>
        </div>

        <div class="grid gap-2">
          <Label for="description">Description</Label>
          <Textarea
            id="description"
            v-model="form.description"
            rows="3"
            maxlength="500"
            placeholder="Ranch Store policy expert — returns, refunds, delivery, promo codes."
          />
          <p class="text-xs text-muted-foreground">
            Shown on the agent card so peers know when to ask this one, and to
            people who open this agent's share link. Leave empty to fall back
            to the template description.
          </p>
        </div>

        <div class="grid gap-2">
          <Label for="template">Template</Label>
          <Select v-model="form.templateId">
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
          <p class="text-xs text-muted-foreground">
            The template can't be changed after creation.
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
          <AgentKnowledgeBindingPicker
            v-model="form.knowledgeIds"
            :knowledges="knowledges"
          />
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
        <p v-if="capacity" class="sm:col-span-2 text-xs text-muted-foreground">
          These are burst limits — scheduling always reserves
          {{ formatCpuMilli(capacity.slotCpuMilli) }} /
          {{ formatMemBytes(capacity.slotMemBytes) }} per agent regardless.
          Free on agent nodes right now:
          <span class="font-medium text-foreground">
            {{ formatCpuMilli(capacity.maxNodeFreeCpuMilli) }}</span>
          ·
          <span class="font-medium text-foreground">
            {{ formatMemBytes(capacity.maxNodeFreeMemBytes) }}</span>
          ·
          <span
            :class="capacity.freeAgentSlots === 0 ? 'font-medium text-amber-600' : ''"
          >
            {{ capacity.freeAgentSlots }}
            {{ capacity.freeAgentSlots === 1 ? 'slot' : 'slots' }} free
          </span>
        </p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Visibility</CardTitle>
        <CardDescription>
          A new agent starts private.
        </CardDescription>
      </CardHeader>
      <CardContent class="max-w-xl">
        <!-- The checkbox that lived here could make an agent public with no
             request limits. Public / private, the allowed origins and the
             limits a public agent must have are one save, in one place. -->
        <p class="text-sm text-muted-foreground" data-visibility-hint>
          Whether the agent is public, its allowed origins and its request
          limits are set together on the agent's Overview, in
          <span class="font-medium text-foreground">Access</span> and
          <span class="font-medium text-foreground">Request limit</span>.
        </p>
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
