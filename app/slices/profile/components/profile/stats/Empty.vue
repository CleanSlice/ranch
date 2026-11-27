<script setup lang="ts">
/**
 * The Statistics tab of someone who has not talked to an agent in the period
 * or the one before (CLEAN-258): one card that says where the figures come
 * from and leads to the agents. No empty charts are drawn (spec 038, User
 * Story 1, scenario 5).
 *
 * The installation view has the same card in its own words (CLEAN-265), for
 * an installation where nothing was recorded in the period or the one
 * before: no usage, no conversation, no incident.
 */
defineProps<{
  /** The installation's wording instead of the person's own. */
  installation?: boolean;
}>();

const titleId = useId();
</script>

<template>
  <section class="stats-card stats-rise" :aria-labelledby="titleId" data-stats-empty>
    <div class="stats-empty">
      <div class="stats-empty__icon" aria-hidden="true">
        <Icon name="chart-column" :size="20" />
      </div>
      <!-- Literal keys in both branches: `i18n:check` reads a key only where
           it is written out. -->
      <template v-if="installation">
        <h2 :id="titleId" class="stats-empty__title">{{ $t('stats.installation.empty_title') }}</h2>
        <p class="stats-empty__text">{{ $t('stats.installation.empty_text') }}</p>
      </template>
      <template v-else>
        <h2 :id="titleId" class="stats-empty__title">{{ $t('stats.state.empty_title') }}</h2>
        <p class="stats-empty__text">{{ $t('stats.state.empty_text') }}</p>
      </template>
      <NuxtLink to="/agents" class="stats-go" data-stats-to-agents>
        <Icon name="message-square" :size="14" aria-hidden="true" />
        {{ $t('profile.to_agents') }}
      </NuxtLink>
    </div>
  </section>
</template>
