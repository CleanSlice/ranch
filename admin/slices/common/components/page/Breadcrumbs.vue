<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router';
import { PAGE_TITLE_TARGET_ID, usePageCrumbs } from '#common/composables/usePageCrumbs';

/**
 * Where the reader is (CLEAN-132): `Users / Jane`, `Templates / Coder /
 * Edit`. Every item but the last is a link; the last is the current page.
 * Replaces the "← Back to users" links, which said where you could go but
 * not where you were.
 *
 * In the admin layout the trail is the top bar's title (CLEAN-135): it is
 * moved into the bar's title slot and counted in, so the bar drops its
 * fallback section name. On a layout without that bar it stays in place.
 */
export interface IBreadcrumb {
  label: string;
  to?: RouteLocationRaw;
}

defineOptions({ inheritAttrs: false });

defineProps<{ items: IBreadcrumb[] }>();

const crumbs = usePageCrumbs();
const inBar = ref(false);

onMounted(() => {
  if (!document.getElementById(PAGE_TITLE_TARGET_ID)) return;
  inBar.value = true;
  crumbs.value++;
});

onBeforeUnmount(() => {
  if (inBar.value) crumbs.value--;
});
</script>

<template>
  <Teleport :to="`#${PAGE_TITLE_TARGET_ID}`" :disabled="!inBar">
    <nav
      v-bind="$attrs"
      class="flex min-w-0 items-center gap-2 text-[13.5px]"
      :class="inBar ? 'flex-nowrap' : 'flex-wrap'"
      aria-label="Breadcrumb"
    >
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
  </Teleport>
</template>
