<script setup lang="ts">
/**
 * The one card that stands where topics, outcomes and open questions would
 * (CLEAN-270), on an installation that produces no conversation summaries:
 * one explanation instead of three empty blocks (spec 038, FR-011).
 *
 * Shown by `summaries.enabled` of the answer and by nothing else. With
 * summaries off every count read from them is zero, so a zero cannot tell
 * "off" from "nothing yet"; the provider decides, and this only words it.
 *
 * The text depends on who reads it. A User cannot switch summaries on and is
 * told who can, and that the rest of the page does not need them. The owner
 * and an administrator are told that they are off for the installation and
 * what switches them on (`SummariesHow.vue`).
 */
defineProps<{
  /** The owner or an administrator: the same rule that offers the scope switch. */
  operator: boolean;
}>();
</script>

<template>
  <ProfileStatsCard
    class="stats-rise"
    :title="$t('stats.summaries.off_title')"
    :caption="$t('stats.summaries.off_caption')"
    :data-stats-wording="operator ? 'operator' : 'user'"
  >
    <div class="stats-soft">
      <b>{{ $t('stats.summaries.off_lead') }}</b>
      <br />
      <!-- Literal keys in both branches: `i18n:check` reads a key only where
           it is written out. -->
      <template v-if="operator">
        {{ $t('stats.summaries.off_operator') }}
        <ProfileStatsSummariesHow />
      </template>
      <template v-else>{{ $t('stats.summaries.off_user') }}</template>
    </div>
  </ProfileStatsCard>
</template>
