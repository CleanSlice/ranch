<template>
  <div ref="pageEl" class="landing-page">
    <LandingHeroProvider />
    <LandingStepsProvider />
    <LandingCapabilitiesProvider />
    <LandingRuntimeProvider />
    <LandingCtaProvider />
  </div>
</template>

<script setup lang="ts">
// The landing has its own layout: floating navigation over a full-bleed
// scene instead of the console header. Every section below the hero reveals
// on scroll through one observer owned by this page.
definePageMeta({ layout: 'landing' });

const pageEl = ref<HTMLElement | null>(null);
useReveal(pageEl);
</script>
