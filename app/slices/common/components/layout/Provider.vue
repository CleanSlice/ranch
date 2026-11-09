<template>
  <div class="min-h-screen flex flex-col bg-background">
    <header
      class="sticky top-0 z-40 shrink-0 backdrop-blur bg-background/80 border-b"
    >
      <div class="container mx-auto flex items-center h-14 px-4 gap-5">
        <NuxtLink to="/" class="flex items-center" :aria-label="$t('app_name')">
          <LandingBrandLogo variant="full" :size="28" :label="null" />
        </NuxtLink>

        <nav
          class="hidden md:flex items-center gap-0.5 rounded-full border bg-card/60 p-0.5 text-sm"
        >
          <NuxtLink
            to="/agents"
            class="rounded-full px-3.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
            active-class="bg-muted text-foreground font-medium"
          >
            {{ $t('nav.agents') }}
          </NuxtLink>
          <NuxtLink
            v-if="authStore.isAuthenticated"
            to="/chats"
            class="rounded-full px-3.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
            active-class="bg-muted text-foreground font-medium"
          >
            {{ $t('nav.history') }}
          </NuxtLink>
        </nav>

        <div class="flex-1" />

        <!-- Browser language decides the first render (detectBrowserLanguage);
             this lets the user override it. setLocale writes the same cookie,
             so the choice survives a reload. -->
        <select
          :value="locale"
          :aria-label="$t('locale.label')"
          class="rounded-full border bg-card/60 px-2 py-1 font-mono text-xs uppercase text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          @change="onLocaleChange"
        >
          <option
            v-for="option in locales"
            :key="option.code"
            :value="option.code"
          >
            {{ option.code.toUpperCase() }}
          </option>
        </select>

        <div v-if="authStore.isAuthenticated" class="flex items-center gap-3 text-sm">
          <span class="hidden sm:inline text-muted-foreground" :title="authStore.user?.email ?? ''">
            {{ authStore.user?.name ?? authStore.user?.email }}
          </span>
          <span
            v-if="authStore.role"
            class="hidden sm:inline rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-primary"
          >
            {{ roleKey ? $t(roleKey) : authStore.role }}
          </span>
          <button
            type="button"
            class="text-muted-foreground hover:text-foreground transition-colors"
            @click="onLogout"
          >
            {{ $t('auth.sign_out') }}
          </button>
        </div>
        <div v-else class="flex items-center gap-3 text-sm">
          <NuxtLink to="/login" class="text-muted-foreground hover:text-foreground transition-colors">
            {{ $t('auth.sign_in') }}
          </NuxtLink>
          <NuxtLink
            v-if="registrationEnabled"
            to="/register"
            class="rounded-full bg-primary text-primary-foreground px-3.5 py-1.5 text-xs font-semibold hover:opacity-90 transition"
          >
            {{ $t('auth.sign_up') }}
          </NuxtLink>
        </div>
      </div>
    </header>

    <main class="flex-1 min-h-0 flex flex-col">
      <!-- Single slot with a toggled wrapper class. Splitting this into
           v-if/v-else branches (each with its own <slot/>) tears down and
           recreates the page subtree whenever `isFlush` flips — i.e. on every
           navigation into/out of /agents/:id — which remounts the page and
           re-fires all its useAsyncData requests. One element = no remount. -->
      <div
        :class="
          isFlush
            ? 'flex-1 min-h-0 flex flex-col'
            : 'container mx-auto px-4 py-6 w-full'
        "
      >
        <slot />
      </div>
    </main>

    <footer v-if="!isFlush" class="shrink-0 border-t">
      <div
        class="container mx-auto px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground"
      >
        <div>{{ $t('footer.note', { year }) }}</div>
        <div class="flex items-center gap-4">
          <NuxtLink to="/agents" class="hover:text-foreground">
            {{ $t('nav.agents') }}
          </NuxtLink>
          <NuxtLink to="/templates" class="hover:text-foreground">
            {{ $t('nav.templates') }}
          </NuxtLink>
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { UserRoleTypes } from '#auth/domain/auth.types';

// The console is the dark RANCH theme (`.dark` in default.css) set in the
// brand typefaces; the landing and the gate paint themselves from the same
// values through their own tokens.
useHead({ htmlAttrs: { class: 'dark' } });
useBrandFonts();

const route = useRoute();
const authStore = useAuthStore();
const { locale, locales, setLocale } = useI18n();
const year = new Date().getFullYear();

// A role the console knows is shown through its key: `role.owner`, `role.admin`…
// One it does not know is shown as received.
const KNOWN_ROLES = new Set<string>(Object.values(UserRoleTypes));
const roleKey = computed(() => {
  const role = authStore.role;
  return role && KNOWN_ROLES.has(role) ? `role.${role.toLowerCase()}` : null;
});

async function onLocaleChange(event: Event) {
  await setLocale((event.target as HTMLSelectElement).value as typeof locale.value);
}

// Pages that own the full content area (no container padding, no footer).
// Matches /agents/:id (chat-first agent detail) but NOT /agents or /agents/create.
const isFlush = computed(() => {
  const p = route.path;
  return /^\/agents\/[^/]+$/.test(p) && p !== '/agents/create';
});

// Show "Sign up" only when self-service registration is open. Lazy-loaded
// once on first paint — refreshes when admin flips the setting on next nav.
const { enabled: registrationEnabled, refresh: refreshRegistration } =
  useRegistrationEnabled();

if (!authStore.isAuthenticated) {
  await useAsyncData('app-layout-registration-enabled', () => refreshRegistration());
}

async function onLogout() {
  authStore.logout();
  await navigateTo('/');
}
</script>
