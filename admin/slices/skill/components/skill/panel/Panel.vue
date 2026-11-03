<script setup lang="ts">
import { Check, Copy } from 'lucide-vue-next';
import { formatDate } from '#common/utils/format';
import type { ISkillData } from '#skill/domain';
import { groupMeta } from '#skill/domain/skill.groups';
import { formatTokens } from '#skill/utils/formatTokens';
import { skillFolder } from '#skill/utils/slugify';
import { shareOfLibrary } from '#skill/utils/summary';

const props = defineProps<{
  skill: ISkillData | null;
  totalTokens: number;
  /** Which host renders it — the e2e scripts and the close affordance read it. */
  host: 'column' | 'drawer' | 'sheet';
  deleting: boolean;
  /** Open with the Delete confirmation already showing (a phone's ⋯ menu). */
  confirmDeleteFor?: string | null;
}>();

const emit = defineEmits<{ delete: [skill: ISkillData] }>();

const meta = computed(() => groupMeta(props.skill?.group));
const folder = computed(() => (props.skill ? skillFolder(props.skill.name) : ''));
const share = computed(() =>
  props.skill ? shareOfLibrary(props.skill.tokenEstimate, props.totalTokens) : 0,
);

// "Copied" for two seconds: long enough to read, short enough that the
// button is back to its name before the next click.
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;
async function copyPath() {
  if (!folder.value) return;
  try {
    await navigator.clipboard.writeText(folder.value);
    copied.value = true;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied.value = false), 2000);
  } catch {
    copied.value = false;
  }
}
onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer);
});

// The inline Delete confirmation resets whenever the panel shows another skill.
const confirming = ref(false);
watch(
  [() => props.skill?.id, () => props.confirmDeleteFor],
  ([id, requested]) => {
    confirming.value = !!id && requested === id;
  },
  { immediate: true },
);
</script>

<template>
  <section data-skill-panel :data-host="host" class="flex flex-col gap-5 text-sm" aria-label="Skill details">
    <template v-if="skill">
      <header class="flex flex-col gap-2">
        <span class="w-fit rounded px-1.5 py-0.5 text-xs font-medium" :class="meta.chip">{{ meta.label }}</span>
        <h2 class="text-xl font-semibold leading-tight [overflow-wrap:anywhere]">{{ skill.title }}</h2>
        <code class="w-fit rounded bg-muted px-1.5 py-0.5 text-xs [overflow-wrap:anywhere]">{{ folder }}</code>
        <Button variant="outline" size="sm" class="w-fit" data-action="copy-path" :aria-live="copied ? 'polite' : undefined" @click="copyPath">
          <Check v-if="copied" class="size-3.5" aria-hidden="true" />
          <Copy v-else class="size-3.5" aria-hidden="true" />
          {{ copied ? 'Copied' : 'Copy path' }}
        </Button>
      </header>

      <dl class="grid grid-cols-3 gap-3 border-y py-3">
        <div>
          <dt class="text-xs text-muted-foreground">Tokens</dt>
          <dd class="font-mono text-lg font-semibold tabular-nums">≈ {{ formatTokens(skill.tokenEstimate) }}</dd>
          <dd class="text-xs text-muted-foreground">{{ share }}% of library</dd>
        </div>
        <div>
          <dt class="text-xs text-muted-foreground">Files</dt>
          <dd class="font-mono text-lg font-semibold tabular-nums">{{ skill.filesCount }}</dd>
          <dd class="text-xs text-muted-foreground">besides body</dd>
        </div>
        <div>
          <dt class="text-xs text-muted-foreground">Created</dt>
          <dd class="text-lg font-semibold">{{ formatDate(skill.createdAt) }}</dd>
        </div>
      </dl>

      <div>
        <h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</h3>
        <p v-if="skill.description" class="whitespace-pre-line">{{ skill.description }}</p>
        <p v-else class="text-muted-foreground">No description.</p>
      </div>

      <div>
        <h3 class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Used in templates</h3>
        <div v-if="skill.templates.length" class="flex flex-wrap gap-1.5">
          <Button v-for="t in skill.templates" :key="t.id" variant="secondary" size="sm" as-child>
            <NuxtLink :to="`/templates/${t.id}`">{{ t.name }}</NuxtLink>
          </Button>
        </div>
        <p v-else class="text-amber-700 dark:text-amber-400">Not in any template</p>
        <p class="mt-1 text-xs text-muted-foreground">Attach or detach it on the Templates page.</p>
      </div>

      <div>
        <h3 class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Activity</h3>
        <SkillPanelActivity :skill="skill" />
      </div>

      <SkillPanelDeleteInline
        v-if="confirming"
        :slug="skill.name"
        :templates="skill.templates"
        :deleting="deleting"
        @keep="confirming = false"
        @confirm="emit('delete', skill)"
      />
      <footer v-else class="flex items-center gap-2 border-t pt-4">
        <Button as-child>
          <NuxtLink :to="`/skills/${skill.id}/edit`">Edit skill</NuxtLink>
        </Button>
        <Button variant="ghost" class="text-destructive" data-action="start-delete" @click="confirming = true">Delete</Button>
      </footer>
    </template>

    <p v-else class="rounded-md border border-dashed p-6 text-center text-muted-foreground">
      Pick a skill to see its details
    </p>
  </section>
</template>
