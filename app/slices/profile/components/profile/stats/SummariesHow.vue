<script setup lang="ts">
import { SUMMARY_INTERVAL_VARIABLE } from '#profile/domain';

/**
 * What switches conversation summaries on, said to an operator (CLEAN-270):
 * the summary interval and an active Anthropic credential, which is what the
 * API's `ChatInsightService.isEnabled()` checks.
 *
 * One sentence in one place. The "summaries off" card of the personal view
 * and the line under the installation's quality table both put this
 * component after their own words, so the two cannot come to disagree about
 * the setting or its name.
 *
 * The setting's name is not text to translate: it is what the operator types
 * into the installation's configuration, and it comes from the domain.
 */
</script>

<template>
  <i18n-t scope="global" keypath="stats.summaries.how" tag="span" data-stats-summaries-how>
    <template #variable>
      <code class="stats-code">{{ SUMMARY_INTERVAL_VARIABLE }}</code>
    </template>
  </i18n-t>
</template>
