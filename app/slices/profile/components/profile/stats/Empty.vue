<script setup lang="ts">
/**
 * The Statistics tab of someone who has not talked to an agent in the period
 * or the one before (CLEAN-258): one card that says where the figures come
 * from and leads to the agents. No empty charts are drawn (spec 038, User
 * Story 1, scenario 5).
 */
const titleId = useId();
</script>

<template>
  <section class="stats-card stats-rise" :aria-labelledby="titleId" data-stats-empty>
    <div class="stats-empty">
      <div class="stats-empty__icon" aria-hidden="true">
        <Icon name="chart-column" :size="20" />
      </div>
      <h2 :id="titleId" class="stats-empty__title">{{ $t('stats.state.empty_title') }}</h2>
      <p class="stats-empty__text">{{ $t('stats.state.empty_text') }}</p>
      <NuxtLink to="/agents" class="stats-go" data-stats-to-agents>
        <Icon name="message-square" :size="14" aria-hidden="true" />
        {{ $t('profile.to_agents') }}
      </NuxtLink>
    </div>
  </section>
</template>
