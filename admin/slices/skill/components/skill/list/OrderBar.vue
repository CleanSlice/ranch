<script setup lang="ts">
/**
 * The pending-order bar (CLEAN-205): shown while the admin has dragged rows
 * and not yet saved. On a phone it is pinned to the bottom with the Reorder
 * mode's Cancel; elsewhere it sits above the list.
 */
defineProps<{
  movedCount: number;
  saving: boolean;
  pinned: boolean;
}>();

const emit = defineEmits<{ discard: []; save: [] }>();
</script>

<template>
  <div
    data-skill-order-bar
    role="status"
    class="flex flex-wrap items-center gap-3 border bg-card px-4 py-3 text-sm shadow-sm"
    :class="pinned ? 'fixed inset-x-0 bottom-0 z-40 rounded-t-lg pb-[max(0.75rem,env(safe-area-inset-bottom))]' : 'sticky top-2 z-10 rounded-md'"
  >
    <span class="font-medium">
      List order changed: {{ movedCount }} {{ movedCount === 1 ? 'position' : 'positions' }} moved
    </span>
    <div class="ml-auto flex gap-2">
      <Button variant="outline" size="sm" :class="pinned && 'min-h-11'" data-action="discard" :disabled="saving" @click="emit('discard')">
        {{ pinned ? 'Cancel' : 'Discard' }}
      </Button>
      <Button size="sm" :class="pinned && 'min-h-11'" data-action="save-order" :disabled="saving" @click="emit('save')">
        {{ saving ? 'Saving…' : 'Save order' }}
      </Button>
    </div>
  </div>
</template>
