<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router';

/**
 * The line above a page's heading (CLEAN-132): `Users / Jane`, `Templates /
 * Coder / Edit`. Every item but the last is a link; the last is where the
 * reader is. Replaces the "← Back to users" links, which said where you
 * could go but not where you were.
 */
export interface IBreadcrumb {
  label: string;
  to?: RouteLocationRaw;
}

defineProps<{ items: IBreadcrumb[] }>();
</script>

<template>
  <nav class="flex min-w-0 flex-wrap items-center gap-2 text-[13.5px]" aria-label="Breadcrumb">
    <template v-for="(item, i) in items" :key="i">
      <span v-if="i > 0" class="text-muted-foreground/40" aria-hidden="true">/</span>
      <NuxtLink
        v-if="item.to && i < items.length - 1"
        :to="item.to"
        class="truncate text-muted-foreground transition-colors hover:text-foreground"
      >
        {{ item.label }}
      </NuxtLink>
      <span v-else class="truncate font-medium" :aria-current="i === items.length - 1 ? 'page' : undefined">
        {{ item.label }}
      </span>
    </template>
  </nav>
</template>
