<script setup lang="ts">
/**
 * The four non-list states of the Skills page (CLEAN-205). The loading one
 * mirrors the page's shape — summary, strip, six rows — so nothing jumps
 * when the data lands.
 */
export type SkillListState = 'loading' | 'error' | 'empty' | 'no-match';

defineProps<{
  state: SkillListState;
  message?: string | null;
}>();

const emit = defineEmits<{ retry: []; clear: [] }>();
</script>

<template>
  <div :data-skill-state="state">
    <template v-if="state === 'loading'">
      <div class="mb-6 grid grid-cols-2 gap-6 md:grid-cols-4">
        <Skeleton v-for="i in 4" :key="i" class="h-14" />
      </div>
      <Skeleton class="mb-6 h-6 w-full" />
      <div class="flex flex-col gap-3">
        <Skeleton v-for="i in 6" :key="i" class="h-20" />
      </div>
      <span class="sr-only" role="status">Loading skills</span>
    </template>

    <div
      v-else-if="state === 'error'"
      role="alert"
      class="flex flex-col items-start gap-3 rounded-md border border-destructive/40 p-6 text-sm"
    >
      <p>{{ message || 'Could not load the skills.' }}</p>
      <Button variant="outline" size="sm" @click="emit('retry')">Retry</Button>
    </div>

    <div
      v-else-if="state === 'empty'"
      class="flex flex-col items-center gap-4 rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground"
    >
      <p>No skills yet. Write one or import one from GitHub to make it available to your templates.</p>
      <div class="flex flex-wrap justify-center gap-2">
        <Button as-child>
          <NuxtLink to="/skills/create">New skill</NuxtLink>
        </Button>
        <Button variant="outline" as-child>
          <NuxtLink to="/skills/import">Import from GitHub</NuxtLink>
        </Button>
      </div>
    </div>

    <div
      v-else
      class="flex flex-col items-center gap-3 rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground"
    >
      <p>No skills match</p>
      <Button variant="outline" size="sm" @click="emit('clear')">Clear search and filters</Button>
    </div>
  </div>
</template>
