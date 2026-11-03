<script setup lang="ts">
import { onKeyStroke, until, useMediaQuery } from '@vueuse/core';
import type { ISkillInput, ISkillTemplateRef } from '#skill/domain';
import { SKILL_GROUP_KEYS, SKILL_GROUP_META } from '#skill/domain/skill.groups';
import type { SkillDraftValues } from '#skill/composables/useSkillDraft';
import { slugify } from '#skill/utils/slugify';
import { countLines, estimateTokens } from '#skill/utils/tokens';

/**
 * The New / Edit skill form (CLEAN-205). The slug follows the title until
 * the admin edits it; validity is live (format and a server check); the
 * description counts against an advisory 140; the body shows lines and an
 * approximate token count; the preview on the right is the row the list
 * will draw and the markdown the agent will read. Header actions belong to
 * the page: it calls `submit()` and reads `valid` / `dirty` through a ref.
 */
const props = defineProps<{
  mode: 'create' | 'edit';
  initialValues?: Partial<SkillDraftValues>;
  /** Edit mode: this skill's own name is not "taken". */
  skillId?: string | null;
  originalName?: string | null;
  templates?: ISkillTemplateRef[];
  submitting?: boolean;
  /** A 409 from the server that the live check did not catch. */
  serverError?: string | null;
}>();

const emit = defineEmits<{
  submit: [values: ISkillInput];
  change: [values: SkillDraftValues];
}>();

const DESCRIPTION_BUDGET = 140;

const initial = props.initialValues ?? {};
const form = reactive<SkillDraftValues>({
  title: initial.title ?? '',
  name: initial.name ?? '',
  group: initial.group ?? null,
  description: initial.description ?? '',
  body: initial.body ?? '',
});
const baseline = JSON.stringify(form);

// Edit mode, or a restored draft whose slug already differs from its title,
// means the admin owns the slug.
const slugTouched = ref(
  props.mode === 'edit' || (!!initial.name && initial.name !== slugify(initial.title ?? '')),
);
watch(
  () => form.title,
  (title) => {
    if (!slugTouched.value) form.name = slugify(title);
  },
);

const slugValid = ref(false);
const slugChecking = ref(false);
function onSlugValidity(valid: boolean, checking: boolean) {
  slugValid.value = valid;
  slugChecking.value = checking;
}

const titleError = computed(() => (form.title.trim() ? null : 'Title is required'));
const bodyError = computed(() => (form.body.trim() ? null : 'Body is required'));
const valid = computed(() => !titleError.value && !bodyError.value && slugValid.value);
const dirty = computed(() => JSON.stringify(form) !== baseline);

const descriptionCount = computed(() => form.description.length);
const overBudget = computed(() => descriptionCount.value > DESCRIPTION_BUDGET);
const lines = computed(() => countLines(form.body));
const tokens = computed(() => estimateTokens(form.body));

watch(form, (v) => emit('change', { ...v }), { deep: true });

async function submit() {
  // A check in flight: wait for its answer rather than racing the server.
  if (slugChecking.value) await until(slugChecking).toBe(false);
  if (!valid.value || props.submitting) return;
  emit('submit', {
    name: form.name.trim(),
    title: form.title.trim(),
    body: form.body,
    description: form.description.trim(),
    group: form.group,
  });
}

onKeyStroke((e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    void submit();
  }
});

// Two columns from `lg` (1024): form left, sticky preview right. Below, one
// column with Write | Preview tabs and the row preview under the form.
const twoColumns = useMediaQuery('(min-width: 1024px)', { ssrWidth: 1280 });

defineExpose({ submit, valid, dirty });
</script>

<template>
  <form class="flex flex-col gap-6" novalidate @submit.prevent="submit">
    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
      <div class="flex min-w-0 flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
            <CardDescription>
              The name becomes the folder under <code>.agent/skills/</code> inside every agent;
              the title is what people read.
            </CardDescription>
          </CardHeader>
          <CardContent class="grid gap-4">
            <div class="grid gap-2">
              <Label for="title">Title</Label>
              <Input
                id="title"
                v-model="form.title"
                placeholder="DevOps engineer"
                :aria-invalid="titleError && form.title !== '' ? 'true' : undefined"
                aria-describedby="title-hint"
              />
              <p id="title-hint" class="text-xs text-muted-foreground">Shown bold in the list and in the panel.</p>
            </div>

            <SkillItemSlugField
              v-model="form.name"
              :exclude-id="skillId"
              :original-name="originalName"
              :server-error="serverError"
              @touched="slugTouched = true"
              @validity="onSlugValidity"
            />

            <div class="grid gap-2">
              <Label for="group">Group</Label>
              <select
                id="group"
                v-model="form.group"
                class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option :value="null">No group</option>
                <option v-for="key in SKILL_GROUP_KEYS" :key="key" :value="key">
                  {{ SKILL_GROUP_META[key].label }}
                </option>
              </select>
              <p class="text-xs text-muted-foreground">Colours the row and the size strip; filters the library.</p>
            </div>

            <div class="grid gap-2">
              <div class="flex items-baseline justify-between gap-3">
                <Label for="description">Description (optional)</Label>
                <span
                  data-description-count
                  class="text-xs tabular-nums"
                  :class="overBudget ? 'text-destructive' : 'text-muted-foreground'"
                  aria-live="polite"
                >
                  {{ descriptionCount }} / {{ DESCRIPTION_BUDGET }}
                </span>
              </div>
              <Textarea
                id="description"
                v-model="form.description"
                rows="2"
                placeholder="One line on when an agent should reach for it"
                aria-describedby="description-hint"
              />
              <p id="description-hint" class="text-xs" :class="overBudget ? 'text-destructive' : 'text-muted-foreground'">
                <template v-if="overBudget">The list cuts descriptions after {{ DESCRIPTION_BUDGET }} characters.</template>
                <template v-else>Two lines at most in the list; the panel shows it in full.</template>
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div class="flex flex-wrap items-baseline justify-between gap-3">
              <CardTitle><label for="body">Body (markdown)</label></CardTitle>
              <span class="text-xs tabular-nums text-muted-foreground">
                <span data-body-lines>{{ lines }}</span> {{ lines === 1 ? 'line' : 'lines' }} ·
                ≈ <span data-body-tokens>{{ tokens }}</span> tokens
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <Textarea
              v-if="twoColumns"
              id="body"
              v-model="form.body"
              rows="22"
              placeholder="# Skill content&#10;&#10;Instructions, prompts, examples…"
              class="font-mono text-xs"
              spellcheck="false"
              :aria-invalid="bodyError && form.body !== '' ? 'true' : undefined"
            />
            <Tabs v-else default-value="write">
              <TabsList>
                <TabsTrigger value="write">Write</TabsTrigger>
                <TabsTrigger value="preview">Preview</TabsTrigger>
              </TabsList>
              <TabsContent value="write">
                <Textarea
                  id="body"
                  v-model="form.body"
                  rows="18"
                  placeholder="# Skill content&#10;&#10;Instructions, prompts, examples…"
                  class="font-mono text-xs"
                  spellcheck="false"
                />
              </TabsContent>
              <TabsContent value="preview">
                <SkillItemPreview :body="form.body" />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Templates</CardTitle>
          </CardHeader>
          <CardContent class="text-sm text-muted-foreground">
            <template v-if="mode === 'create'">
              A new skill is not in any template. Attach it on the Templates page after you create it.
            </template>
            <template v-else-if="templates && templates.length">
              <div class="flex flex-wrap gap-1.5">
                <Button v-for="t in templates" :key="t.id" variant="secondary" size="sm" as-child>
                  <NuxtLink :to="`/templates/${t.id}`">{{ t.name }}</NuxtLink>
                </Button>
              </div>
              <p class="mt-2">Attach or detach it on the Templates page.</p>
            </template>
            <template v-else>Not in any template. Attach it on the Templates page.</template>
          </CardContent>
        </Card>

        <div v-if="!twoColumns" class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">How the list shows it</h3>
          <SkillItemRowPreview
            :title="form.title"
            :name="form.name"
            :description="form.description"
            :group="form.group"
            :tokens="tokens"
            :templates="templates"
            :saved="mode === 'edit' && !dirty"
          />
        </div>
      </div>

      <aside v-if="twoColumns" class="sticky top-4 flex flex-col gap-4" aria-label="Preview">
        <div class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">How the list shows it</h3>
          <SkillItemRowPreview
            :title="form.title"
            :name="form.name"
            :description="form.description"
            :group="form.group"
            :tokens="tokens"
            :templates="templates"
            :saved="mode === 'edit' && !dirty"
          />
        </div>
        <div class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What the agent reads</h3>
          <div class="max-h-[60vh] overflow-y-auto">
            <SkillItemPreview :body="form.body" />
          </div>
        </div>
      </aside>
    </div>
  </form>
</template>
