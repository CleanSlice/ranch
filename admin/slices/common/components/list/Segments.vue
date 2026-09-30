<script setup lang="ts" generic="K extends string">
/**
 * A segmented filter (CLEAN-132): "All / ≤ 512 MiB / 1 GiB", "All 4 /
 * Attached 1". One is always on; it behaves as a radio group.
 */
const model = defineModel<K>({ required: true });

defineProps<{
  options: readonly { key: K; label: string }[];
  label: string;
}>();
</script>

<template>
  <div class="flex gap-1 rounded-[9px] bg-muted p-[3px]" role="radiogroup" :aria-label="label">
    <button
      v-for="o in options"
      :key="o.key"
      type="button"
      role="radio"
      :aria-checked="model === o.key"
      class="h-[30px] rounded-md px-[11px] text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      :class="model === o.key ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
      @click="model = o.key"
    >
      {{ o.label }}
    </button>
  </div>
</template>
