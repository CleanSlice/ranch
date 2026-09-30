<script setup lang="ts">
import { templateHue, templateInitials } from '#template/utils/templateFormat';

/**
 * The initials tile that stands in for a template everywhere it is listed
 * (CLEAN-130): the same id always gets the same hue, so a template is
 * recognisable across the list, its own page and the rows that name it.
 */
const props = withDefaults(
  defineProps<{
    id: string;
    name: string;
    size?: 'sm' | 'md' | 'lg';
  }>(),
  { size: 'md' },
);

const SIZES = {
  sm: 'size-8 rounded-lg text-xs',
  md: 'size-10 rounded-[10px] text-sm',
  lg: 'size-14 rounded-[14px] text-lg',
} as const;

const initials = computed(() => templateInitials(props.name));
const style = computed(() => ({ '--tile-hue': String(templateHue(props.id)) }));
</script>

<template>
  <span
    class="grid shrink-0 place-items-center font-semibold bg-[oklch(0.95_0.035_var(--tile-hue))] text-[oklch(0.42_0.13_var(--tile-hue))] dark:bg-[oklch(0.3_0.06_var(--tile-hue))] dark:text-[oklch(0.85_0.1_var(--tile-hue))]"
    :class="SIZES[size]"
    :style="style"
    aria-hidden="true"
  >
    {{ initials }}
  </span>
</template>
