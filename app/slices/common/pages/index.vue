<template>
  <div class="-mx-4 -my-6">
    <LandingHeroProvider />

    <section class="container mx-auto px-4 py-20 border-t">
      <div class="max-w-2xl mb-12">
        <div class="text-sm font-medium text-primary mb-3">
          {{ $t('landing.what_eyebrow') }}
        </div>
        <h2 class="text-3xl sm:text-4xl font-bold tracking-tight">
          {{ $t('landing.what_title') }}
        </h2>
        <p class="mt-4 text-muted-foreground">
          {{ $t('landing.what_lede') }}
        </p>
      </div>

      <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div
          v-for="feature in features"
          :key="feature.key"
          class="rounded-xl border p-6 hover:border-primary transition-colors"
        >
          <div
            class="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4"
          >
            <Icon :name="feature.icon" :size="20" />
          </div>
          <h3 class="font-semibold mb-2">
            {{ $t(`features.${feature.key}_title`) }}
          </h3>
          <p class="text-sm text-muted-foreground">
            {{ $t(`features.${feature.key}_body`) }}
          </p>
        </div>
      </div>
    </section>

    <section class="bg-muted/30 border-y">
      <div class="container mx-auto px-4 py-20">
        <div class="max-w-2xl mb-12">
          <div class="text-sm font-medium text-primary mb-3">
            {{ $t('landing.how_eyebrow') }}
          </div>
          <h2 class="text-3xl sm:text-4xl font-bold tracking-tight">
            {{ $t('landing.how_title') }}
          </h2>
        </div>

        <ol class="grid md:grid-cols-3 gap-6">
          <li
            v-for="(step, idx) in steps"
            :key="step"
            class="rounded-xl border bg-background p-6"
          >
            <div class="text-xs text-muted-foreground mb-2">
              {{ $t('landing.step', { number: idx + 1 }) }}
            </div>
            <h3 class="font-semibold mb-2">{{ $t(`steps.${step}_title`) }}</h3>
            <p class="text-sm text-muted-foreground">
              {{ $t(`steps.${step}_body`) }}
            </p>
          </li>
        </ol>
      </div>
    </section>

    <section class="container mx-auto px-4 py-20">
      <div
        class="rounded-2xl border bg-gradient-to-br from-primary/10 to-transparent p-10 text-center"
      >
        <h2 class="text-3xl sm:text-4xl font-bold tracking-tight">
          {{ $t('landing.cta_title') }}
        </h2>
        <p class="mt-3 text-muted-foreground max-w-lg mx-auto">
          {{ $t('landing.cta_lede') }}
        </p>
        <NuxtLink
          to="/agents"
          class="mt-8 inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-6 py-3 text-sm font-medium hover:opacity-90 transition"
        >
          {{ $t('landing.cta_button') }}
        </NuxtLink>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
// Copy lives in the locale files (features.<key>_title / _body); only the icon
// and the ordering are structural, so that's all that stays here.
const features = [
  { key: 'templates', icon: 'package' },
  { key: 'chat', icon: 'message-square' },
  { key: 'status', icon: 'activity' },
  { key: 'restart', icon: 'refresh-cw' },
  { key: 'logs', icon: 'scroll-text' },
  { key: 'admin', icon: 'users' },
];

const steps = ['template', 'deploy', 'chat'];
</script>
