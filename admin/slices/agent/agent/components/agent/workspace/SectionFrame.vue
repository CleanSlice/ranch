<script setup lang="ts">
import { IconArrowLeft } from '@tabler/icons-vue';
import type { ISection } from './sections';

/**
 * The row above an open section (specs/017, R2): the way back to the
 * Settings hub and the section's name. The section itself renders in the
 * default slot exactly as it did under the old tab bar.
 */
defineProps<{ section: ISection }>();

defineEmits<{ back: [] }>();
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3">
    <div class="flex shrink-0 items-center gap-2">
      <Button variant="ghost" size="sm" class="-ml-2" @click="$emit('back')">
        <IconArrowLeft class="size-4" />
        Settings
      </Button>
      <span class="text-muted-foreground/60">/</span>
      <span class="text-sm font-medium">{{ section.title }}</span>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <slot />
    </div>
  </div>
</template>
