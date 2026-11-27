<script setup lang="ts">
import { IconLock } from '@tabler/icons-vue';
import type { RouteLocationRaw } from 'vue-router';

/**
 * A page opened by an address the API answered "not found" for (CLEAN-269):
 * a record that does not exist, or one of an agent this viewer may not read.
 * The two look the same on purpose, and nothing of the record is drawn: no
 * header of it, no empty feed that reads as "nothing was said".
 */
const props = defineProps<{
  /** What the page shows, as a noun: "chat", "evaluation". */
  what: string;
  /** The one sentence under the title (`notAvailableText` of the viewer). */
  hint: string;
  /** The list this record belongs to, and what to call it. */
  backTo: RouteLocationRaw;
  backLabel: string;
}>();

const crumbs = computed(() => [
  { label: props.backLabel, to: props.backTo },
  { label: 'Not available' },
]);
</script>

<template>
  <div class="flex w-full flex-col gap-4" data-not-available>
    <PageBreadcrumbs :items="crumbs" class="min-w-0" />
    <div
      class="flex flex-col items-center gap-2.5 rounded-xl border border-dashed px-6 py-14 text-center"
    >
      <span
        class="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground"
      >
        <IconLock class="size-5" aria-hidden="true" />
      </span>
      <span class="text-[15px] font-semibold">This {{ what }} is not available</span>
      <span class="text-[13px] text-muted-foreground">{{ hint }}</span>
      <Button as-child variant="outline" size="sm" class="mt-1.5">
        <NuxtLink :to="backTo">Back to {{ backLabel.toLowerCase() }}</NuxtLink>
      </Button>
    </div>
  </div>
</template>
