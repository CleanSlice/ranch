<script setup lang="ts">
import { computed } from 'vue'
import { Wrench } from 'lucide-vue-next'
import { Button } from '#theme/components/ui/button'
import { useToolCatalogStore } from '../../stores/toolCatalog'

/**
 * Opens the Tools sheet for one agent (CLEAN-109). Sits in the page header
 * beside Share and Edit; the sheet itself is mounted by the chat composer,
 * which is the component that inserts the picked template.
 */
const props = withDefaults(
  defineProps<{
    agentId: string
    size?: 'sm' | 'default'
    class?: string
  }>(),
  { size: 'sm', class: undefined },
)

const store = useToolCatalogStore()
const isOpen = computed(() => store.sheetOpenFor === props.agentId)
</script>

<template>
  <Button
    variant="outline"
    :size="size"
    :class="props.class"
    :aria-expanded="isOpen"
    title="What this agent can do — click a tool to drop a starter prompt into the chat"
    @click="store.openSheet(agentId)"
  >
    <Wrench class="size-4" />
    Tools
  </Button>
</template>
