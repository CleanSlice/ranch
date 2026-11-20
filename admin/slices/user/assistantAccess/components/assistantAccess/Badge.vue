<script setup lang="ts">
import { LEVEL_LABELS } from '#assistantAccess/utils/assistantAccess';

/**
 * The level the signed-in person uses the assistant at, next to its name
 * (CLEAN-240, contracts/ui.md §D). A narrowed assistant looks broken unless
 * the person can see that it was narrowed, and by whom.
 *
 * Their own level and counts per area; nothing about anybody else. Drawn for
 * nobody the assistant has no setting for: the Owner sees no badge.
 */
const store = useAssistantAccessStore();
const open = ref(false);

onMounted(() => {
  // A badge that cannot be read is a badge that is not there.
  void store.fetchMine().catch(() => undefined);
});

const mine = computed(() => store.mine);
const shown = computed(
  () => mine.value !== null && mine.value.enabled && mine.value.level !== 'owner',
);
const label = computed(() => {
  const level = mine.value?.level;
  return level && level !== 'owner' ? LEVEL_LABELS[level] : '';
});
</script>

<template>
  <span v-if="shown && mine" class="relative inline-flex" data-assistant-badge>
    <button
      type="button"
      class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
      :aria-expanded="open"
      aria-controls="assistant-badge-areas"
      :title="`You use the assistant at the ${label} level`"
      @click="open = !open"
      @keydown.esc="open = false"
    >
      {{ label }}
    </button>
    <span
      v-if="open"
      id="assistant-badge-areas"
      class="absolute top-full left-0 z-30 mt-2 flex w-64 flex-col gap-2 rounded-md border bg-popover p-3 text-xs shadow-md"
      role="group"
      aria-label="What the assistant can do for you"
    >
      <span class="font-medium text-foreground">
        What the assistant can do for you
      </span>
      <span
        v-for="area in mine.areas"
        :key="area.key"
        class="flex items-baseline justify-between gap-3"
      >
        <span class="truncate">{{ area.title }}</span>
        <span class="shrink-0 tabular-nums text-muted-foreground">
          {{ area.offered }} of {{ area.available }}
        </span>
      </span>
      <span class="border-t pt-2 text-muted-foreground">
        The Owner decides what the assistant can do for you.
      </span>
    </span>
  </span>
</template>
