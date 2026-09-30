<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from '#theme/utils'

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <tfoot
    data-slot="table-footer"
    :class="cn('border-t text-xs text-muted-foreground [&>tr]:last:border-b-0 [&>tr]:hover:bg-transparent', props.class)"
  >
    <slot />
  </tfoot>
</template>
