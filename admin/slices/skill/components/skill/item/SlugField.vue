<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core';
import { skillFolder, slugError } from '#skill/utils/slugify';

/**
 * The Name (slug) field of the skill form (CLEAN-205): format checked on
 * every keystroke, uniqueness checked against the server after a 300 ms
 * pause. Only the latest answer counts — a slow reply for an older value
 * must not mark the current one taken. On Edit the skill's own name is
 * free by definition, and changing it warns about the folder rename.
 */
const props = defineProps<{
  modelValue: string;
  /** Edit mode: the skill whose own name does not count as taken. */
  excludeId?: string | null;
  originalName?: string | null;
  /** The server said "taken" after the live check missed it (a 409). */
  serverError?: string | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  /** The admin typed in this field: the title no longer drives it. */
  touched: [];
  validity: [valid: boolean, checking: boolean];
}>();

const skillStore = useSkillStore();

type Availability = 'unknown' | 'checking' | 'free' | 'taken';
const availability = ref<Availability>('unknown');
let seq = 0;

const check = useDebounceFn(async (name: string) => {
  const mine = ++seq;
  try {
    const result = await skillStore.isNameAvailable(name, props.excludeId ?? undefined);
    if (mine !== seq) return;
    availability.value = result.available ? 'free' : 'taken';
  } catch {
    // The server did not answer: do not block the form on it, the API's
    // unique index still refuses a duplicate with a 409 the form shows.
    if (mine === seq) availability.value = 'free';
  }
}, 300);

const formatError = computed(() => slugError(props.modelValue));

watch(
  () => props.modelValue,
  (value) => {
    seq++;
    if (formatError.value) {
      availability.value = 'unknown';
      return;
    }
    if (props.originalName && value === props.originalName) {
      availability.value = 'free';
      return;
    }
    availability.value = 'checking';
    void check(value);
  },
  { immediate: true },
);

const error = computed(
  () =>
    formatError.value ??
    (availability.value === 'taken' ? 'This name is taken' : null) ??
    props.serverError ??
    null,
);
const checking = computed(() => availability.value === 'checking');
const valid = computed(() => error.value === null && availability.value === 'free');
const renamed = computed(
  () => !!props.originalName && props.modelValue !== props.originalName && error.value === null,
);

watch([valid, checking], ([v, c]) => emit('validity', v, c), { immediate: true });

function onInput(value: string | number) {
  emit('touched');
  emit('update:modelValue', String(value));
}
</script>

<template>
  <div class="grid gap-2">
    <Label for="name">Name (slug)</Label>
    <Input
      id="name"
      :model-value="modelValue"
      placeholder="devops"
      autocomplete="off"
      spellcheck="false"
      class="font-mono"
      :aria-invalid="error ? 'true' : undefined"
      aria-describedby="name-hint"
      @update:model-value="onInput"
    />
    <p
      id="name-hint"
      class="text-xs"
      :class="error ? 'text-destructive' : renamed ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'"
    >
      <template v-if="error">{{ error }}</template>
      <template v-else-if="renamed">
        Renaming moves the folder to <code>{{ skillFolder(modelValue) }}</code> in every agent on the next redeploy.
      </template>
      <template v-else>
        Folder: <code>{{ skillFolder(modelValue || '…') }}</code>
        <span v-if="checking" class="ml-1">· Checking…</span>
      </template>
    </p>
  </div>
</template>
