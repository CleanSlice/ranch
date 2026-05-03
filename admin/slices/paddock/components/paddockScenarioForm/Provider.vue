<script setup lang="ts">
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { Button } from '#theme/components/ui/button';
import { Textarea } from '#theme/components/ui/textarea';
import { Label } from '#theme/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '#theme/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#theme/components/ui/select';
import { IconSparkles, IconCode } from '@tabler/icons-vue';
import type {
  IPaddockScenario,
  ICreatePaddockScenario,
  IUpdatePaddockScenario,
  PaddockScenarioCategory,
  PaddockScenarioDifficulty,
} from '#paddock/stores/paddockScenario';

const props = defineProps<{
  open: boolean;
  templateId?: string;
  agentId?: string;
  scenario?: IPaddockScenario | null;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  saved: [scenario: IPaddockScenario];
}>();

const store = usePaddockScenarioStore();
const saving = ref(false);
const saveError = ref<string | null>(null);

const CATEGORIES: PaddockScenarioCategory[] = [
  'tool_use',
  'memory',
  'conversation',
  'patching_workflow',
  'edge_case',
  'multi_turn',
  'error_recovery',
];

const DIFFICULTIES: PaddockScenarioDifficulty[] = [
  'easy',
  'medium',
  'hard',
  'adversarial',
];

const yamlContent = ref('');
const hasYaml = computed(() => yamlContent.value.trim().length > 0);

const description = ref('');
const hintCategory = ref<PaddockScenarioCategory | undefined>(undefined);
const hintDifficulty = ref<PaddockScenarioDifficulty | undefined>(undefined);
const generating = ref(false);
const generateError = ref<string | null>(null);
const generated = ref(false);

watch(
  () => [props.open, props.scenario] as const,
  ([open, scenario]) => {
    if (!open) return;
    saveError.value = null;
    generateError.value = null;
    description.value = '';
    hintCategory.value = undefined;
    hintDifficulty.value = undefined;
    generated.value = false;
    yamlContent.value = scenario ? scenarioToYaml(scenario) : '';
  },
  { immediate: true },
);

async function onGenerate() {
  if (!description.value.trim()) {
    generateError.value = 'Describe what you want to test first';
    return;
  }
  generating.value = true;
  generateError.value = null;
  try {
    const draft = await store.generate({
      description: description.value,
      templateId: props.templateId ?? null,
      agentId: props.agentId ?? null,
      category: hintCategory.value,
      difficulty: hintDifficulty.value,
    });
    yamlContent.value = scenarioToYaml({ ...draft, setup: draft.setup ?? null });
    generated.value = true;
  } catch (err: unknown) {
    generateError.value =
      err instanceof Error ? err.message : 'Generation failed';
  } finally {
    generating.value = false;
  }
}

function startBlank() {
  yamlContent.value = `category: conversation
difficulty: medium
name: my-scenario
description: ""
expectedBehavior: ""
messages:
  - text: ""
    from: eval-user
successCriteria:
  - dimension: correctness
    description: Agent answers correctly
    weight: 1.0
`;
}

async function onSave() {
  saving.value = true;
  saveError.value = null;
  try {
    const parsed = yamlParse(yamlContent.value) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('YAML must be a mapping');
    }
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    const successCriteria = Array.isArray(parsed.successCriteria)
      ? parsed.successCriteria
      : [];

    if (props.scenario) {
      const patch: IUpdatePaddockScenario = {
        category: parsed.category as PaddockScenarioCategory,
        difficulty: parsed.difficulty as PaddockScenarioDifficulty,
        name: String(parsed.name ?? ''),
        description: String(parsed.description ?? ''),
        expectedBehavior: String(parsed.expectedBehavior ?? ''),
        messages: messages as IUpdatePaddockScenario['messages'],
        successCriteria:
          successCriteria as IUpdatePaddockScenario['successCriteria'],
        setup: (parsed.setup as IUpdatePaddockScenario['setup']) ?? null,
      };
      const updated = await store.update(props.scenario.id, patch);
      emit('saved', updated);
    } else {
      const create: ICreatePaddockScenario = {
        templateId: props.templateId ?? null,
        agentId: props.agentId ?? null,
        category: parsed.category as PaddockScenarioCategory,
        difficulty: parsed.difficulty as PaddockScenarioDifficulty,
        name: String(parsed.name ?? ''),
        description: String(parsed.description ?? ''),
        expectedBehavior: String(parsed.expectedBehavior ?? ''),
        messages: messages as ICreatePaddockScenario['messages'],
        successCriteria:
          successCriteria as ICreatePaddockScenario['successCriteria'],
        setup: (parsed.setup as ICreatePaddockScenario['setup']) ?? null,
      };
      const created = await store.create(create);
      emit('saved', created);
    }
    emit('update:open', false);
  } catch (err: unknown) {
    saveError.value =
      err instanceof Error ? err.message : 'Failed to save scenario.';
  } finally {
    saving.value = false;
  }
}

function scenarioToYaml(s: Pick<
  IPaddockScenario,
  | 'category'
  | 'difficulty'
  | 'name'
  | 'description'
  | 'expectedBehavior'
  | 'messages'
  | 'successCriteria'
  | 'setup'
>): string {
  const obj: Record<string, unknown> = {
    category: s.category,
    difficulty: s.difficulty,
    name: s.name,
    description: s.description,
    expectedBehavior: s.expectedBehavior,
    messages: s.messages,
    successCriteria: s.successCriteria,
  };
  if (s.setup) obj.setup = s.setup;
  return yamlStringify(obj, { lineWidth: 0 });
}
</script>

<template>
  <Sheet :open="open" @update:open="(v: boolean) => emit('update:open', v)">
    <SheetContent class="w-full sm:max-w-2xl overflow-y-auto">
      <SheetHeader class="px-6 pt-6">
        <SheetTitle>{{ scenario ? 'Edit scenario' : 'New scenario' }}</SheetTitle>
        <SheetDescription>
          {{
            scenario
              ? 'Tweak the YAML below and save.'
              : 'Describe what you want to test in plain language — Claude drafts the YAML for you. Or write the YAML by hand.'
          }}
        </SheetDescription>
      </SheetHeader>

      <div class="flex flex-col gap-6 px-6 pb-6">
        <!-- Step 1: describe (only for new scenarios) -->
        <section v-if="!scenario" class="rounded-lg border bg-card">
          <div class="flex items-center gap-2 border-b px-4 py-3">
            <span class="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">1</span>
            <h3 class="text-sm font-medium">Describe what to test</h3>
            <span class="ml-auto text-xs text-muted-foreground">optional — you can also write YAML directly</span>
          </div>

          <div class="flex flex-col gap-4 p-4">
            <Textarea
              v-model="description"
              rows="4"
              placeholder="e.g. Agent should refuse to call a blocked tool even if the user insists. Try a few prompts that escalate."
            />

            <div class="grid grid-cols-2 gap-3">
              <div class="flex flex-col gap-1.5">
                <Label class="text-xs text-muted-foreground">Category hint</Label>
                <Select v-model="hintCategory">
                  <SelectTrigger>
                    <SelectValue placeholder="let LLM decide" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="c in CATEGORIES" :key="c" :value="c">{{ c }}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div class="flex flex-col gap-1.5">
                <Label class="text-xs text-muted-foreground">Difficulty hint</Label>
                <Select v-model="hintDifficulty">
                  <SelectTrigger>
                    <SelectValue placeholder="let LLM decide" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="d in DIFFICULTIES" :key="d" :value="d">{{ d }}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button :disabled="generating || !description.trim()" @click="onGenerate" class="w-full">
              <IconSparkles class="size-4" />
              {{ generating ? 'Drafting…' : generated ? 'Regenerate' : 'Draft scenario with Claude' }}
            </Button>

            <p
              v-if="generateError"
              class="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {{ generateError }}
            </p>
            <p
              v-else-if="generated"
              class="text-xs text-muted-foreground"
            >
              ✓ Draft below — review and edit, then Save.
            </p>
          </div>
        </section>

        <!-- Step 2: review YAML -->
        <section class="rounded-lg border bg-card">
          <div class="flex items-center gap-2 border-b px-4 py-3">
            <span class="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{{ scenario ? '1' : '2' }}</span>
            <h3 class="text-sm font-medium">{{ scenario ? 'Edit scenario' : 'Review & edit YAML' }}</h3>
            <Button
              v-if="!scenario && !hasYaml"
              variant="ghost"
              size="sm"
              class="ml-auto h-7 text-xs"
              @click="startBlank"
            >
              <IconCode class="size-3" />
              Start blank
            </Button>
          </div>

          <div class="flex flex-col gap-2 p-4">
            <div
              v-if="!hasYaml"
              class="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed py-8 text-sm text-muted-foreground"
            >
              <IconCode class="size-5" />
              <span>{{ scenario ? '' : 'Generate above or click "Start blank" to write YAML manually.' }}</span>
            </div>

            <Textarea
              v-else
              v-model="yamlContent"
              rows="20"
              class="font-mono text-xs leading-relaxed"
              spellcheck="false"
            />

            <p v-if="hasYaml" class="text-xs text-muted-foreground">
              Same format as <code>.paddock/scenarios/*.yml</code>. Save will validate on submit.
            </p>
          </div>
        </section>

        <p
          v-if="saveError"
          class="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {{ saveError }}
        </p>
      </div>

      <SheetFooter class="border-t px-6 py-4">
        <Button variant="outline" :disabled="saving" @click="emit('update:open', false)">Cancel</Button>
        <Button :disabled="saving || !hasYaml" @click="onSave">
          {{ saving ? 'Saving…' : 'Save scenario' }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
