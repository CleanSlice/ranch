<script setup lang="ts">
/**
 * The level the signed-in person uses the assistant at, next to its name
 * (CLEAN-240). A narrowed assistant looks broken unless the person can see
 * that it was narrowed, and by whom.
 *
 * Their own level and counts per area, nothing about anybody else. The area
 * titles come from the server and are shown as received.
 */
const store = useAssistantAccessStore();
const format = useFormat();
const open = ref(false);

onMounted(() => void store.ensureMine());

const mine = computed(() => store.mine);
// The Owner has no level; a person it is off for does not see the assistant.
const shown = computed(
  () => mine.value !== null && mine.value.enabled && mine.value.level !== 'owner',
);
// Copy decided in script travels as a key (docs/i18n.md).
const levelKey = computed(() => `assistantAccess.level_${mine.value?.level ?? 'basic'}`);
</script>

<template>
  <span v-if="shown && mine" class="relative inline-flex" data-assistant-badge>
    <button
      type="button"
      class="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition hover:bg-muted"
      :aria-expanded="open"
      aria-controls="assistant-badge-areas"
      :title="$t('assistantAccess.badge_title')"
      @click.stop="open = !open"
      @keydown.esc="open = false"
    >
      {{ $t(levelKey) }}
    </button>
    <span
      v-if="open"
      id="assistant-badge-areas"
      class="absolute left-0 top-full z-30 mt-2 flex w-64 max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-xl border bg-popover p-3 text-xs shadow-lg"
      role="group"
      :aria-label="$t('assistantAccess.areas_title')"
    >
      <span class="font-medium text-foreground">
        {{ $t('assistantAccess.areas_title') }}
      </span>
      <span
        v-for="area in mine.areas"
        :key="area.key"
        class="flex items-baseline justify-between gap-3"
      >
        <span class="truncate">{{ area.title }}</span>
        <span class="shrink-0 tabular-nums text-muted-foreground">
          {{
            $t('assistantAccess.area_count', {
              offered: format.number(area.offered),
              available: format.number(area.available),
            })
          }}
        </span>
      </span>
      <span class="border-t pt-2 text-muted-foreground">
        {{ $t('assistantAccess.who_decides') }}
      </span>
    </span>
  </span>
</template>
