<script setup lang="ts">
import { IconSearch } from '@tabler/icons-vue';

/** The search box of a list (CLEAN-132): one width, one icon, one placeholder style. */
const model = defineModel<string>({ required: true });

withDefaults(defineProps<{ placeholder?: string }>(), { placeholder: 'Search' });
</script>

<template>
  <div class="relative min-w-60 max-w-md flex-1">
    <IconSearch class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    <Input v-model="model" type="search" :placeholder="placeholder" class="pl-9" />
  </div>
</template>
