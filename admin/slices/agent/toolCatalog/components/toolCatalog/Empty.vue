<script setup lang="ts">
import { AlertCircle, SearchX, Wrench } from 'lucide-vue-next'
import { Skeleton } from '#theme/components/ui/skeleton'

/** The panel's non-list states: loading, failed, no tools, no matches. */
defineProps<{
  kind: 'loading' | 'error' | 'empty' | 'no-results'
  message?: string | null
}>()

const emit = defineEmits<{
  retry: []
  clear: []
}>()
</script>

<template>
  <div v-if="kind === 'loading'" class="flex flex-col gap-3 px-1 py-2" aria-busy="true">
    <Skeleton v-for="i in 6" :key="i" class="h-9 w-full" />
  </div>

  <div
    v-else-if="kind === 'error'"
    class="flex flex-col items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-3 text-sm"
    role="alert"
  >
    <span class="flex items-center gap-2 text-destructive">
      <AlertCircle class="size-4 shrink-0" />
      Could not load the tools.
    </span>
    <span v-if="message" class="text-xs text-muted-foreground">{{ message }}</span>
    <button
      type="button"
      class="cursor-pointer rounded-md border px-2 py-1 text-xs font-medium transition-colors hover:bg-muted"
      @click="emit('retry')"
    >
      Retry
    </button>
  </div>

  <div
    v-else-if="kind === 'no-results'"
    class="flex flex-col items-center gap-2 px-3 py-8 text-center text-sm text-muted-foreground"
  >
    <SearchX class="size-6" />
    <span>No tool matches that.</span>
    <button
      type="button"
      class="cursor-pointer text-xs underline underline-offset-2 hover:no-underline"
      @click="emit('clear')"
    >
      Clear the search
    </button>
  </div>

  <div
    v-else
    class="flex flex-col items-center gap-2 px-3 py-8 text-center text-sm text-muted-foreground"
  >
    <Wrench class="size-6" />
    <span>This agent has no tools from Ranch.</span>
  </div>
</template>
