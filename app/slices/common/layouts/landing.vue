<template>
  <div class="landing" @animationend="onLandingAnimationEnd">
    <LandingHeaderProvider />
    <main>
      <slot />
    </main>
    <LandingFooterProvider />
    <!-- Same session-ended dialog as the console layout: a signed-in visitor
         can be on the landing page when the token runs out (CLEAN-72). -->
    <AuthSessionEndedProvider />
  </div>
</template>

<script setup lang="ts">
useLandingChrome();
</script>
