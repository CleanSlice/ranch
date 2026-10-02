<script setup lang="ts" generic="K extends string">
import { IconArrowsSort } from '@tabler/icons-vue';

/**
 * The "Sort: Newest" control of a list (CLEAN-132). Two options toggle on
 * click; more open a menu. Either way the button reads the same on every
 * page.
 */
const model = defineModel<K>({ required: true });

const props = defineProps<{
  options: readonly { key: K; label: string }[];
}>();

const current = computed(
  () => props.options.find((o) => o.key === model.value)?.label ?? '',
);

function toggle() {
  const i = props.options.findIndex((o) => o.key === model.value);
  const next = props.options[(i + 1) % props.options.length];
  if (next) model.value = next.key;
}
</script>

<template>
  <button
    v-if="options.length <= 2"
    type="button"
    class="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    :title="`Sort by ${current}`"
    @click="toggle"
  >
    Sort:
    <span class="font-medium text-foreground">{{ current }}</span>
    <IconArrowsSort class="size-3.5" />
  </button>

  <DropdownMenu v-else>
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        class="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Sort:
        <span class="font-medium text-foreground">{{ current }}</span>
        <IconArrowsSort class="size-3.5" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuRadioGroup :model-value="model" @update:model-value="(v) => (model = v as K)">
        <DropdownMenuRadioItem v-for="o in options" :key="o.key" :value="o.key">
          {{ o.label }}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
