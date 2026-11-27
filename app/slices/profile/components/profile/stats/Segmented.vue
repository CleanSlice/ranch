<script setup lang="ts" generic="T extends string | number">
/**
 * A row of choices where one is on (CLEAN-258): the period, and later the
 * scope, as a button group with `aria-pressed`; the two tabs as a `tablist`.
 *
 * It chooses nothing itself: the value comes from the address
 * (`utils/statsView.ts`) and a click only says which one was asked for.
 *
 * A label is a key, not text (docs/i18n.md): the options are built in script.
 */
const props = withDefaults(
  defineProps<{
    options: readonly {
      value: T;
      labelKey: string;
      params?: Record<string, unknown>;
      icon?: string;
    }[];
    modelValue: T;
    /** What the group chooses, for a reader who cannot see it. */
    label: string;
    /** The hook each button carries: `data-stats-<name>="<value>"`. */
    name: string;
    variant?: 'group' | 'tabs';
    size?: 'md' | 'sm';
    /** Tabs only: a tab is `<idPrefix>-<value>`, its panel `<idPrefix>-panel`. */
    idPrefix?: string;
  }>(),
  { variant: 'group', size: 'md', idPrefix: undefined },
);

const emit = defineEmits<{ 'update:modelValue': [value: T] }>();

const isTabs = computed(() => props.variant === 'tabs');

// Tabs are one stop for the Tab key and are walked with the arrows, as the
// ARIA pattern has it. The arrows only move focus: a tab is opened by Enter,
// Space or a click, because opening one changes the address.
function onKeydown(event: KeyboardEvent, index: number) {
  if (!isTabs.value) return;
  const last = props.options.length - 1;
  let next: number | null = null;
  if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1;
  else if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = last;
  if (next === null) return;
  event.preventDefault();
  const buttons = (event.currentTarget as HTMLElement).parentElement?.children;
  (buttons?.[next] as HTMLElement | undefined)?.focus();
}
</script>

<template>
  <div
    class="stats-seg"
    :class="size === 'sm' && 'stats-seg--sm'"
    :role="isTabs ? 'tablist' : 'group'"
    :aria-label="label"
  >
    <button
      v-for="(option, index) in options"
      :id="isTabs && idPrefix ? `${idPrefix}-${option.value}` : undefined"
      :key="option.value"
      type="button"
      class="stats-seg__item"
      :role="isTabs ? 'tab' : undefined"
      :aria-selected="isTabs ? option.value === modelValue : undefined"
      :aria-pressed="isTabs ? undefined : option.value === modelValue"
      :aria-controls="isTabs && idPrefix ? `${idPrefix}-panel` : undefined"
      :tabindex="isTabs && option.value !== modelValue ? -1 : undefined"
      v-bind="{ [`data-stats-${name}`]: option.value }"
      @click="emit('update:modelValue', option.value)"
      @keydown="onKeydown($event, index)"
    >
      <Icon v-if="option.icon" :name="option.icon" :size="14" aria-hidden="true" />
      {{ $t(option.labelKey, option.params ?? {}) }}
    </button>
  </div>
</template>
