<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import { Checkbox } from '#theme/components/ui/checkbox';
import { Input } from '#theme/components/ui/input';
import { Skeleton } from '#theme/components/ui/skeleton';
import { IconSearch } from '@tabler/icons-vue';

const props = defineProps<{
  templateId: string;
  initialSkillIds: string[];
}>();

const emit = defineEmits<{ saved: [skillIds: string[]] }>();

const templateStore = useTemplateStore();
const skillStore = useSkillStore();

const { pending: skillsPending } = useAsyncData(
  'admin-template-skills-list',
  () => skillStore.fetchAll(),
  { lazy: true },
);

const selected = ref<Set<string>>(new Set(props.initialSkillIds));
watch(
  () => props.initialSkillIds,
  (ids) => (selected.value = new Set(ids)),
);

const filter = ref('');
const filteredSkills = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return skillStore.items;
  return skillStore.items.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.title.toLowerCase().includes(q) ||
      (s.description ?? '').toLowerCase().includes(q),
  );
});

const dirty = computed(() => {
  if (selected.value.size !== props.initialSkillIds.length) return true;
  for (const id of props.initialSkillIds) {
    if (!selected.value.has(id)) return true;
  }
  return false;
});

const saving = ref(false);
const error = ref<string | null>(null);

function toggle(id: string, on: boolean) {
  const next = new Set(selected.value);
  if (on) next.add(id);
  else next.delete(id);
  selected.value = next;
}

async function onSave() {
  saving.value = true;
  error.value = null;
  try {
    const ids = [...selected.value];
    await templateStore.setSkills(props.templateId, ids);
    emit('saved', ids);
  } catch (err) {
    const e = err as { message?: string; response?: { data?: { message?: string } } };
    error.value = e?.response?.data?.message ?? e?.message ?? 'Save failed';
  } finally {
    saving.value = false;
  }
}

function onReset() {
  selected.value = new Set(props.initialSkillIds);
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="relative">
      <IconSearch class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        v-model="filter"
        placeholder="Filter by name, title, or description"
        class="pl-9"
      />
    </div>

    <div v-if="skillsPending && skillStore.items.length === 0" class="flex flex-col gap-2">
      <Skeleton v-for="i in 4" :key="i" class="h-14 w-full rounded-md" />
    </div>

    <div
      v-else-if="filteredSkills.length === 0"
      class="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground"
    >
      <template v-if="skillStore.items.length === 0">
        No skills yet. Create or import one in
        <NuxtLink to="/skills" class="underline">Skills</NuxtLink>.
      </template>
      <template v-else>No skills match your filter.</template>
    </div>

    <ul v-else class="flex flex-col divide-y rounded-md border">
      <li
        v-for="skill in filteredSkills"
        :key="skill.id"
        class="flex items-start gap-3 px-3 py-3"
      >
        <Checkbox
          :id="`skill-${skill.id}`"
          :model-value="selected.has(skill.id)"
          class="mt-0.5"
          @update:model-value="(v: boolean | 'indeterminate') => toggle(skill.id, v === true)"
        />
        <label :for="`skill-${skill.id}`" class="flex-1 cursor-pointer">
          <div class="flex items-center gap-2 text-sm font-medium">
            {{ skill.title }}
            <code class="text-xs text-muted-foreground">{{ skill.name }}</code>
          </div>
          <p
            v-if="skill.description"
            class="mt-0.5 text-xs text-muted-foreground"
          >
            {{ skill.description }}
          </p>
        </label>
      </li>
    </ul>

    <p v-if="error" class="text-xs text-destructive">{{ error }}</p>

    <div class="flex items-center gap-3">
      <Button :disabled="!dirty || saving" @click="onSave">
        {{ saving ? 'Saving…' : 'Save skills' }}
      </Button>
      <Button
        type="button"
        variant="ghost"
        :disabled="!dirty || saving"
        @click="onReset"
      >
        Reset
      </Button>
      <span class="text-xs text-muted-foreground">
        {{ selected.size }} selected
      </span>
    </div>
  </div>
</template>
