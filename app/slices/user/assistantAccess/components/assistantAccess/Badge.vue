<script setup lang="ts">
import {
  BADGE_CARD_GUTTER,
  BADGE_CARD_WIDTH,
  badgeCardShift,
} from '#assistantAccess/utils/assistantAccess';

/**
 * The level the signed-in person uses the assistant at, next to its name
 * (CLEAN-240). A narrowed assistant looks broken unless the person can see
 * that it was narrowed, and by whom.
 *
 * Their own level, and area by area what that comes to: the count on the
 * row, and under it the abilities by title (CLEAN-257: "9 of 15" tells
 * nobody what they may ask for). Nothing about anybody else. The area and
 * ability titles come from the server and are shown as received.
 *
 * The record is the store's; which rows are open is this card's own.
 */
const store = useAssistantAccessStore();
const format = useFormat();
const open = ref(false);
const openAreas = ref<Set<string>>(new Set());
const root = ref<HTMLElement | null>(null);
// How far the card is moved from the badge's left edge to stay on screen.
const shift = ref(0);

const mine = computed(() => store.mine);
// The Owner has no level; a person it is off for does not see the assistant.
const shown = computed(
  () => mine.value !== null && mine.value.enabled && mine.value.level !== 'owner',
);
// Copy decided in script travels as a key (docs/i18n.md).
const levelKey = computed(() => `assistantAccess.level_${mine.value?.level ?? 'basic'}`);

/** The badge sits wherever the name ends: the card is kept in the viewport. */
function place() {
  if (!root.value) return;
  const viewport = document.documentElement.clientWidth;
  shift.value = badgeCardShift(
    root.value.getBoundingClientRect().left,
    viewport,
    Math.min(BADGE_CARD_WIDTH, viewport - BADGE_CARD_GUTTER * 2),
  );
}

function toggle() {
  open.value = !open.value;
  if (open.value) place();
}

function toggleArea(key: string) {
  const next = new Set(openAreas.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  openAreas.value = next;
}

const onResize = () => {
  if (open.value) place();
};

onMounted(() => {
  void store.ensureMine();
  window.addEventListener('resize', onResize);
});
onBeforeUnmount(() => window.removeEventListener('resize', onResize));
</script>

<template>
  <span
    v-if="shown && mine"
    ref="root"
    class="relative inline-flex"
    data-assistant-badge
    @keydown.esc="open = false"
  >
    <button
      type="button"
      class="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition hover:bg-muted"
      :aria-expanded="open"
      aria-controls="assistant-badge-areas"
      :title="$t('assistantAccess.badge_title')"
      @click.stop="toggle"
    >
      {{ $t(levelKey) }}
    </button>
    <span
      v-if="open"
      id="assistant-badge-areas"
      class="absolute top-full z-30 mt-2 flex max-h-[min(28rem,70vh)] w-72 max-w-[calc(100vw-2rem)] flex-col overflow-y-auto overscroll-contain rounded-xl border bg-popover p-3 text-xs font-normal text-popover-foreground shadow-lg"
      :style="{ left: `${shift}px` }"
      role="group"
      :aria-label="$t('assistantAccess.areas_title')"
      @click.stop
    >
      <span class="pb-1 font-medium text-foreground">
        {{ $t('assistantAccess.areas_title') }}
      </span>
      <span
        v-for="area in mine.areas"
        :key="area.key"
        class="flex flex-col"
        :data-area="area.key"
      >
        <button
          v-if="area.abilities.length"
          type="button"
          class="-mx-1 flex min-h-9 items-center justify-between gap-3 rounded-md px-1 text-left transition hover:bg-muted"
          :aria-expanded="openAreas.has(area.key)"
          :aria-controls="`assistant-badge-area-${area.key}`"
          @click="toggleArea(area.key)"
        >
          <span class="flex min-w-0 items-center gap-1.5">
            <Icon
              name="chevron-right"
              :size="12"
              class="text-muted-foreground transition-transform"
              :class="openAreas.has(area.key) ? 'rotate-90' : ''"
              aria-hidden="true"
            />
            <span class="truncate">{{ area.title }}</span>
          </span>
          <span class="shrink-0 tabular-nums text-muted-foreground">
            {{
              $t('assistantAccess.area_count', {
                offered: format.number(area.offered),
                available: format.number(area.available),
              })
            }}
          </span>
        </button>
        <!-- An API that sends counts only: the row as it was, nothing to open. -->
        <span v-else class="flex min-h-9 items-center justify-between gap-3">
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
        <span
          v-if="area.abilities.length && openAreas.has(area.key)"
          :id="`assistant-badge-area-${area.key}`"
          class="flex flex-col gap-1.5 pt-0.5 pb-2"
          role="list"
        >
          <span
            v-for="ability in area.abilities"
            :key="ability.name"
            class="flex items-start gap-1.5"
            :class="ability.state === 'not_included' && 'text-muted-foreground/70'"
            :data-ability-state="ability.state"
            role="listitem"
          >
            <Icon
              v-if="ability.state === 'included'"
              name="check"
              :size="12"
              class="mt-0.5"
              aria-hidden="true"
            />
            <span v-else class="w-3 shrink-0" aria-hidden="true" />
            <!-- The title is the server's, shown as received (docs/i18n.md). -->
            <span class="min-w-0 break-words">
              {{ ability.title }}
              <span
                v-if="ability.state === 'own_agents_only'"
                class="block text-muted-foreground"
              >
                {{ $t('assistantAccess.ability_own_agents') }}
              </span>
              <span v-else-if="ability.state === 'included'" class="sr-only">
                {{ $t('assistantAccess.ability_included') }}
              </span>
              <span v-else class="sr-only">
                {{ $t('assistantAccess.ability_not_included') }}
              </span>
            </span>
          </span>
        </span>
      </span>
      <span class="mt-1 border-t pt-2 text-muted-foreground">
        {{ $t('assistantAccess.who_decides') }}
      </span>
    </span>
  </span>
</template>
