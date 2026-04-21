<script setup lang="ts">
import { computed } from 'vue';
import type { FunctionalComponent } from 'vue';
import * as icons from 'lucide-vue-next';
import { cn } from '#theme/utils/cn';

const props = withDefaults(
  defineProps<{
    name: string;
    size?: number | string;
    strokeWidth?: number | string;
    class?: string;
  }>(),
  {
    size: 16,
    strokeWidth: 2,
  },
);

function toPascalCase(input: string): string {
  return input
    .replace(/[-_\s]+(.)?/g, (_, c: string | undefined) =>
      c ? c.toUpperCase() : '',
    )
    .replace(/^(.)/, (c) => c.toUpperCase());
}

const IconComponent = computed<FunctionalComponent | null>(() => {
  const pascal = toPascalCase(props.name);
  const registry = icons as unknown as Record<string, FunctionalComponent>;
  return registry[pascal] ?? null;
});
</script>

<template>
  <component
    v-if="IconComponent"
    :is="IconComponent"
    :size="size"
    :stroke-width="strokeWidth"
    :class="cn('inline-block shrink-0', props.class)"
  />
</template>
