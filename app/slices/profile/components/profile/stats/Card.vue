<script setup lang="ts">
/**
 * One card of the Statistics tab (CLEAN-258): a title, a caption, room for an
 * action beside it, the block itself, and at most one line of note under it.
 *
 * The note is one line on purpose (spec 038, FR-028): a block whose figure
 * has a shorter history says so once, not beside every number.
 *
 * The chrome is the Account cards' (`components/profile/Account.vue`), so the
 * two tabs look like one page. The rules live in `assets/stats.css`.
 */
defineProps<{
  title: string;
  caption?: string;
}>();

const titleId = useId();
</script>

<template>
  <section class="stats-card" :aria-labelledby="titleId">
    <div class="stats-card__head">
      <h2 :id="titleId" class="m-0 text-base font-semibold">{{ title }}</h2>
      <span v-if="$slots.action || caption" class="stats-card__aside">
        <slot name="action" />
        <span v-if="caption" class="stats-card__caption">{{ caption }}</span>
      </span>
    </div>

    <slot />

    <p v-if="$slots.note" class="stats-hint" data-stats-note>
      <slot name="note" />
    </p>
  </section>
</template>
