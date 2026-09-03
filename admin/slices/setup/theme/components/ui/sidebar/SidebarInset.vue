<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from '#theme/utils'

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <main
    data-slot="sidebar-inset"
    :class="cn(
      // `min-w-0` is load-bearing, not decoration. This is a flex item next to
      // the sidebar, so without it its min-width resolves to `auto` - the
      // min-content width of whatever is inside. One wide table (or one long
      // unbreakable error string) then pushes the whole inset past the
      // viewport, and the page's own `overflow-x-clip` cannot save it because
      // the blow-out happened in its parent. With `min-w-0` the inset shrinks
      // and the table scrolls inside its own container instead.
      'bg-background relative flex w-full min-w-0 flex-1 flex-col border',
      'md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2',
      props.class,
    )"
  >
    <slot />
  </main>
</template>
