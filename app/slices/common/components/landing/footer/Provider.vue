<template>
  <footer class="land-footer">
    <div class="land-wrap land-footer__row">
      <NuxtLink to="/" class="land-footer__brand" :aria-label="$t('app_name')">
        <LandingBrandLogo variant="full" :size="28" mono :label="null" />
      </NuxtLink>
      <nav class="land-footer__nav" :aria-label="$t('landing_nav.footer')">
        <NuxtLink to="/agents">{{ $t('nav.agents') }}</NuxtLink>
        <NuxtLink to="/templates">{{ $t('nav.templates') }}</NuxtLink>
        <NuxtLink v-if="authStore.isAuthenticated" to="/chats">{{ $t('nav.history') }}</NuxtLink>
        <NuxtLink v-else to="/login">{{ $t('auth.sign_in') }}</NuxtLink>
      </nav>
      <div class="land-footer__meta">
        <span>{{ $t('footer.note', { year }) }}</span>
        <span class="land-footer__version">v{{ version }}</span>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
const authStore = useAuthStore();
const year = new Date().getFullYear();
const version = useRuntimeConfig().public.ranchVersion;
</script>

<style scoped>
.land-footer {
  border-top: 1px solid var(--land-border);
  background: var(--land-bg);
  padding: 2rem 0 2.5rem;
}
.land-footer__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1rem 2rem;
  font-size: 0.8rem;
  color: var(--land-text-3);
}
.land-footer__brand {
  color: var(--land-text-2);
  display: inline-flex;
}
.land-footer__brand:hover {
  color: var(--land-text);
}
.land-footer__nav {
  display: flex;
  gap: 1.25rem;
}
.land-footer__nav a {
  color: var(--land-text-2);
  text-decoration: none;
  min-height: 2.75rem;
  display: inline-flex;
  align-items: center;
}
.land-footer__nav a:hover {
  color: var(--land-text);
}
.land-footer__meta {
  display: flex;
  gap: 1rem;
  align-items: center;
}
.land-footer__version {
  font-family: var(--land-mono);
  font-size: 0.7rem;
}
</style>
